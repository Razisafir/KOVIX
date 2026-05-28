"""
Skill Manager — CRUD operations and marketplace integration.

Provides full lifecycle management for skills:
- Create: parse documents into skills and persist to disk
- Read: list, get, and search skills
- Update: partial and full updates
- Delete: remove skills from storage
- Compose: chain multiple skills into composite skills
- Import/Export: share skills as JSON files

Storage layout::

    resources/skills/
    ├── index.json          # fast lookup index
    ├── <skill_name>.json   # individual skill files
    └── marketplace/        # community/shared skills
        └── ...
"""

from __future__ import annotations

import os
import json
import time
import shutil
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from .skill_parser import Skill, SkillCategory, SkillStep

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default paths
# ---------------------------------------------------------------------------

DEFAULT_SKILLS_DIR = Path("resources/skills")
MARKETPLACE_DIR = Path("resources/skills/marketplace")
INDEX_FILE = Path("resources/skills/index.json")

# ---------------------------------------------------------------------------
# Skill Manager
# ---------------------------------------------------------------------------


class SkillManager:
    """Manages the full lifecycle of skills: CRUD, search, compose, import/export.

    Parameters
    ----------
    skills_dir:
        Root directory where skill JSON files are stored.
        Defaults to ``resources/skills``.
    """

    def __init__(self, skills_dir: Optional[str] = None) -> None:
        self.skills_dir = Path(skills_dir) if skills_dir else DEFAULT_SKILLS_DIR
        self.marketplace_dir = self.skills_dir / "marketplace"
        self.index_file = self.skills_dir / "index.json"
        self._ensure_dirs()
        self._index: Dict[str, Dict[str, Any]] = {}
        self._load_index()

    # -- Internal helpers -----------------------------------------------------

    def _ensure_dirs(self) -> None:
        """Create the skills directory structure if it doesn't exist."""
        self.skills_dir.mkdir(parents=True, exist_ok=True)
        self.marketplace_dir.mkdir(parents=True, exist_ok=True)

    def _load_index(self) -> None:
        """Load the skill index from disk."""
        if self.index_file.exists():
            try:
                with open(self.index_file, "r", encoding="utf-8") as f:
                    self._index = json.load(f)
                logger.debug("Loaded skill index: %d entries", len(self._index))
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning("Failed to load skill index: %s", exc)
                self._index = {}
        else:
            self._index = {}

    def _save_index(self) -> None:
        """Persist the skill index to disk."""
        try:
            with open(self.index_file, "w", encoding="utf-8") as f:
                json.dump(self._index, f, indent=2, default=str)
        except OSError as exc:
            logger.error("Failed to save skill index: %s", exc)

    def _skill_path(self, name: str) -> Path:
        """Return the filesystem path for a named skill file."""
        safe_name = self._sanitize_name(name)
        return self.skills_dir / f"{safe_name}.json"

    def _sanitize_name(self, name: str) -> str:
        """Sanitize a skill name for use as a filename."""
        safe = "".join(c for c in name if c.isalnum() or c in "_-")
        return safe[:100] or "untitled"

    def _add_to_index(self, skill: Skill) -> None:
        """Update the in-memory index with a skill entry."""
        self._index[skill.name] = {
            "name": skill.name,
            "category": skill.category.value,
            "description": skill.description[:200],
            "version": skill.version,
            "confidence": skill.confidence,
            "created_at": skill.created_at,
            "updated_at": time.time(),
            "tags": skill.tags,
            "tools_needed": skill.tools_needed,
            "step_count": len(skill.steps),
            "file": str(self._skill_path(skill.name)),
        }
        self._save_index()

    def _remove_from_index(self, name: str) -> None:
        """Remove a skill from the in-memory index."""
        self._index.pop(name, None)
        self._save_index()

    def _read_skill_file(self, path: Path) -> Optional[Skill]:
        """Read and parse a single skill JSON file."""
        if not path.exists():
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return Skill.from_dict(data)
        except (json.JSONDecodeError, KeyError, OSError) as exc:
            logger.warning("Failed to read skill file %s: %s", path, exc)
            return None

    # -- CRUD Operations ------------------------------------------------------

    def create_skill(self, document_path: str) -> Skill:
        """Parse a document and save the resulting skill to disk.

        Parameters
        ----------
        document_path:
            Path to the document to parse.

        Returns
        -------
        Skill
            The newly created skill.
        """
        from .skill_parser import SkillParser

        parser = SkillParser()
        skill = parser.parse(document_path)
        return self.save_skill(skill)

    def save_skill(self, skill: Skill) -> Skill:
        """Save an existing skill object to disk.

        Parameters
        ----------
        skill:
            The skill to persist.

        Returns
        -------
        Skill
            The saved skill (same object, updated timestamps).
        """
        path = self._skill_path(skill.name)
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(skill.to_dict(), f, indent=2, default=str)
            self._add_to_index(skill)
            logger.info("Skill saved: %s -> %s", skill.name, path)
        except OSError as exc:
            logger.error("Failed to save skill %s: %s", skill.name, exc)
            raise
        return skill

    def list_skills(
        self, category: Optional[SkillCategory] = None
    ) -> List[Skill]:
        """List all skills, optionally filtered by category.

        Parameters
        ----------
        category:
            If provided, only return skills in this category.

        Returns
        -------
        list[Skill]
            Matching skills.
        """
        skills: List[Skill] = []
        for entry in self._index.values():
            if category and entry.get("category") != category.value:
                continue
            name = entry["name"]
            skill = self.get_skill(name)
            if skill:
                skills.append(skill)
        return skills

    def get_skill(self, name: str) -> Optional[Skill]:
        """Load a skill by name.

        Parameters
        ----------
        name:
            The unique skill name (slug).

        Returns
        -------
        Skill | None
            The skill if found, otherwise *None*.
        """
        # Fast path: check index
        if name not in self._index:
            return None
        path = self._skill_path(name)
        return self._read_skill_file(path)

    def update_skill(self, name: str, updates: Dict[str, Any]) -> Optional[Skill]:
        """Apply a partial update to an existing skill.

        Parameters
        ----------
        name:
            Name of the skill to update.
        updates:
            Dictionary of fields to update. Supported keys:
            ``description``, ``steps``, ``tags``, ``examples``,
            ``tools_needed``, ``version``, ``category``.

        Returns
        -------
        Skill | None
            The updated skill, or *None* if not found.
        """
        skill = self.get_skill(name)
        if not skill:
            logger.warning("Update failed: skill not found: %s", name)
            return None

        # Apply allowed updates
        if "description" in updates:
            skill.description = updates["description"]
        if "steps" in updates:
            raw_steps = updates["steps"]
            skill.steps = [
                s if isinstance(s, SkillStep) else SkillStep(**s)
                for s in raw_steps
            ]
        if "tags" in updates:
            skill.tags = list(updates["tags"])
        if "examples" in updates:
            skill.examples = list(updates["examples"])
        if "tools_needed" in updates:
            skill.tools_needed = list(updates["tools_needed"])
        if "version" in updates:
            skill.version = str(updates["version"])
        if "category" in updates:
            cat_val = updates["category"]
            if isinstance(cat_val, str):
                skill.category = SkillCategory(cat_val)
            elif isinstance(cat_val, SkillCategory):
                skill.category = cat_val

        # Save updated skill
        self.save_skill(skill)
        logger.info("Skill updated: %s", name)
        return skill

    def delete_skill(self, name: str) -> bool:
        """Delete a skill by name.

        Parameters
        ----------
        name:
            Name of the skill to remove.

        Returns
        -------
        bool
            *True* if the skill was found and deleted.
        """
        path = self._skill_path(name)
        if path.exists():
            try:
                path.unlink()
                self._remove_from_index(name)
                logger.info("Skill deleted: %s", name)
                return True
            except OSError as exc:
                logger.error("Failed to delete skill %s: %s", name, exc)
        return False

    def skill_exists(self, name: str) -> bool:
        """Check whether a skill exists.

        Parameters
        ----------
        name:
            Skill name to check.

        Returns
        -------
        bool
        """
        return name in self._index and self._skill_path(name).exists()

    # -- Import / Export ------------------------------------------------------

    def import_skill(self, skill_json: str) -> Skill:
        """Import a skill from a JSON string or file path.

        Parameters
        ----------
        skill_json:
            Either a JSON string containing the skill data,
            or a path to a ``.json`` file.

        Returns
        -------
        Skill
            The imported skill, saved to the skills directory.
        """
        # Determine if it's a file path or raw JSON
        if skill_json.strip().endswith(".json") and os.path.isfile(skill_json.strip()):
            with open(skill_json.strip(), "r", encoding="utf-8") as f:
                data = json.load(f)
        else:
            data = json.loads(skill_json)

        skill = Skill.from_dict(data)

        # Handle name collision
        original_name = skill.name
        counter = 1
        while self.skill_exists(skill.name):
            skill.name = f"{original_name}_{counter}"
            counter += 1

        return self.save_skill(skill)

    def export_skill(self, name: str, output_path: Optional[str] = None) -> str:
        """Export a skill to a JSON file.

        Parameters
        ----------
        name:
            Name of the skill to export.
        output_path:
            Destination file path. If *None*, writes to
            ``<skills_dir>/exports/<name>.json``.

        Returns
        -------
        str
            The path to the exported file.
        """
        skill = self.get_skill(name)
        if not skill:
            raise ValueError(f"Skill not found: {name}")

        if output_path:
            dest = Path(output_path)
        else:
            exports_dir = self.skills_dir / "exports"
            exports_dir.mkdir(parents=True, exist_ok=True)
            dest = exports_dir / f"{self._sanitize_name(name)}.json"

        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(skill.to_dict(), f, indent=2, default=str)

        logger.info("Skill exported: %s -> %s", name, dest)
        return str(dest)

    # -- Composition ----------------------------------------------------------

    def compose_skills(self, names: List[str], composite_name: Optional[str] = None) -> Skill:
        """Chain multiple skills into a single composite skill.

        Steps are renumbered sequentially. Tools and tags are merged.

        Parameters
        ----------
        names:
            Names of skills to compose, in order.
        composite_name:
            Optional name for the resulting composite skill.
            Defaults to ``"<first>_composed"``.

        Returns
        -------
        Skill
            The composite skill, automatically saved to disk.

        Raises
        ------
        ValueError
            If any named skill does not exist.
        """
        skills: List[Skill] = []
        for name in names:
            skill = self.get_skill(name)
            if not skill:
                raise ValueError(f"Cannot compose: skill not found: {name}")
            skills.append(skill)

        if not skills:
            raise ValueError("No skills provided for composition")

        # Merge steps with renumbered order
        merged_steps: List[SkillStep] = []
        all_tools: List[str] = []
        all_tags: List[str] = []
        all_examples: List[str] = []
        descriptions: List[str] = []

        step_offset = 0
        for skill in skills:
            for step in skill.steps:
                new_step = SkillStep(
                    order=step_offset + step.order,
                    action=step.action,
                    description=f"[{skill.name}] {step.description}",
                    tool=step.tool,
                    parameters=dict(step.parameters),
                    validation=step.validation,
                )
                merged_steps.append(new_step)
            step_offset += len(skill.steps)
            all_tools.extend(skill.tools_needed)
            all_tags.extend(skill.tags)
            all_examples.extend(skill.examples)
            descriptions.append(f"{skill.name}: {skill.description[:80]}")

        # Determine dominant category
        category_counts: Dict[SkillCategory, int] = {}
        for s in skills:
            category_counts[s.category] = category_counts.get(s.category, 0) + 1
        dominant_category = max(category_counts, key=lambda c: category_counts[c])

        composite = Skill(
            name=composite_name or f"{skills[0].name}_composed",
            description=f"Composite skill: {' + '.join(descriptions)}",
            category=dominant_category,
            steps=merged_steps,
            tools_needed=sorted(set(all_tools)),
            examples=all_examples[:5],
            confidence=round(sum(s.confidence for s in skills) / len(skills), 2),
            tags=sorted(set(all_tags)),
            version="1.0",
        )

        return self.save_skill(composite)

    # -- Search ---------------------------------------------------------------

    def search_skills(self, query: str) -> List[Skill]:
        """Text search across all indexed skills.

        Searches in name, description, tags, tools, and steps.
        Results are ranked by relevance (exact name match > tag match >
        description match).

        Parameters
        ----------
        query:
            Search string (case-insensitive).

        Returns
        -------
        list[Skill]
            Matching skills ordered by relevance.
        """
        query_lower = query.lower()
        scored: List[tuple[float, Skill]] = []

        for entry in self._index.values():
            score = 0.0
            name = entry.get("name", "")
            desc = entry.get("description", "")
            tags = entry.get("tags", [])
            tools = entry.get("tools_needed", [])

            # Name match (highest weight)
            if query_lower in name.lower():
                score += 10.0
                if query_lower == name.lower():
                    score += 5.0  # exact match

            # Tag match
            for tag in tags:
                if query_lower in tag.lower():
                    score += 3.0

            # Tool match
            for tool in tools:
                if query_lower in tool.lower():
                    score += 2.0

            # Description match
            if query_lower in desc.lower():
                score += 1.0

            if score > 0:
                skill = self.get_skill(name)
                if skill:
                    scored.append((score, skill))

        # Sort by score descending
        scored.sort(key=lambda x: x[0], reverse=True)
        return [s for _, s in scored]

    def search_by_tool(self, tool_name: str) -> List[Skill]:
        """Find all skills that require a specific tool.

        Parameters
        ----------
        tool_name:
            Tool name to search for (e.g. ``"docker"``).

        Returns
        -------
        list[Skill]
            Skills that use the tool.
        """
        results: List[Skill] = []
        tool_lower = tool_name.lower()

        for entry in self._index.values():
            tools = [t.lower() for t in entry.get("tools_needed", [])]
            if tool_lower in tools or any(tool_lower in t for t in tools):
                skill = self.get_skill(entry["name"])
                if skill:
                    results.append(skill)

        return results

    def search_by_tag(self, tag: str) -> List[Skill]:
        """Find all skills with a specific tag.

        Parameters
        ----------
        tag:
            Tag to search for.

        Returns
        -------
        list[Skill]
            Skills with the tag.
        """
        results: List[Skill] = []
        tag_lower = tag.lower()

        for entry in self._index.values():
            tags = [t.lower() for t in entry.get("tags", [])]
            if tag_lower in tags or any(tag_lower in t for t in tags):
                skill = self.get_skill(entry["name"])
                if skill:
                    results.append(skill)

        return results

    # -- Marketplace ----------------------------------------------------------

    def publish_to_marketplace(self, name: str) -> str:
        """Copy a skill to the marketplace directory for sharing.

        Parameters
        ----------
        name:
            Name of the skill to publish.

        Returns
        -------
        str
            Path to the published marketplace file.

        Raises
        ------
        ValueError
            If the skill does not exist.
        """
        skill = self.get_skill(name)
        if not skill:
            raise ValueError(f"Skill not found: {name}")

        dest = self.marketplace_dir / f"{self._sanitize_name(name)}.json"
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(skill.to_dict(), f, indent=2, default=str)

        logger.info("Skill published to marketplace: %s -> %s", name, dest)
        return str(dest)

    def list_marketplace_skills(self) -> List[Dict[str, Any]]:
        """List all skills available in the marketplace.

        Returns
        -------
        list[dict]
            Metadata for each marketplace skill.
        """
        skills: List[Dict[str, Any]] = []
        if not self.marketplace_dir.exists():
            return skills

        for path in self.marketplace_dir.glob("*.json"):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                skills.append({
                    "name": data.get("name", path.stem),
                    "description": data.get("description", "")[:200],
                    "category": data.get("category", "unknown"),
                    "version": data.get("version", "1.0"),
                    "tags": data.get("tags", []),
                    "file": str(path),
                })
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning("Failed to read marketplace skill %s: %s", path, exc)

        return skills

    def install_from_marketplace(self, marketplace_name: str) -> Skill:
        """Install a skill from the marketplace into the main skills directory.

        Parameters
        ----------
        marketplace_name:
            Name of the marketplace skill to install.

        Returns
        -------
        Skill
            The installed skill.

        Raises
        ------
        ValueError
            If the marketplace skill is not found.
        """
        source = self.marketplace_dir / f"{self._sanitize_name(marketplace_name)}.json"
        if not source.exists():
            raise ValueError(f"Marketplace skill not found: {marketplace_name}")

        with open(source, "r", encoding="utf-8") as f:
            data = json.load(f)

        skill = Skill.from_dict(data)

        # Handle name collision
        original_name = skill.name
        counter = 1
        while self.skill_exists(skill.name):
            skill.name = f"{original_name}_{counter}"
            counter += 1

        return self.save_skill(skill)

    # -- Statistics & Maintenance ---------------------------------------------

    def get_stats(self) -> Dict[str, Any]:
        """Return statistics about the skill collection.

        Returns
        -------
        dict
            Keys: ``total``, ``by_category``, ``by_tool``, ``avg_confidence``,
            ``avg_steps``.
        """
        total = len(self._index)
        by_category: Dict[str, int] = {}
        by_tool: Dict[str, int] = {}
        confidences: List[float] = []
        step_counts: List[int] = []

        for entry in self._index.values():
            cat = entry.get("category", "unknown")
            by_category[cat] = by_category.get(cat, 0) + 1

            for tool in entry.get("tools_needed", []):
                by_tool[tool] = by_tool.get(tool, 0) + 1

            confidences.append(entry.get("confidence", 0))
            step_counts.append(entry.get("step_count", 0))

        return {
            "total": total,
            "by_category": by_category,
            "by_tool": dict(sorted(by_tool.items(), key=lambda x: x[1], reverse=True)),
            "avg_confidence": round(sum(confidences) / len(confidences), 2) if confidences else 0,
            "avg_steps": round(sum(step_counts) / len(step_counts), 1) if step_counts else 0,
        }

    def rebuild_index(self) -> int:
        """Rebuild the index by scanning the skills directory.

        Returns
        -------
        int
            Number of skills indexed.
        """
        self._index = {}
        count = 0

        for path in self.skills_dir.glob("*.json"):
            skill = self._read_skill_file(path)
            if skill:
                self._add_to_index(skill)
                count += 1

        logger.info("Index rebuilt: %d skills", count)
        return count

    def cleanup_orphans(self) -> int:
        """Remove index entries that no longer have corresponding files.

        Returns
        -------
        int
            Number of orphaned entries removed.
        """
        orphans = [
            name for name in self._index
            if not self._skill_path(name).exists()
        ]
        for name in orphans:
            self._remove_from_index(name)
        if orphans:
            logger.info("Cleaned up %d orphaned index entries", len(orphans))
        return len(orphans)
