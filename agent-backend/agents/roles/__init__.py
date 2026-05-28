"""Agent roles package — re-export all role definitions."""
from .code_engineer import ROLE as CODE_ENGINEER
from .legal_reviewer import ROLE as LEGAL_REVIEWER
from .security_auditor import ROLE as SECURITY_AUDITOR
from .ui_designer import ROLE as UI_DESIGNER
from .devops_engineer import ROLE as DEVOPS_ENGINEER
from .test_engineer import ROLE as TEST_ENGINEER
from .researcher import ROLE as RESEARCHER
from .project_manager import ROLE as PROJECT_MANAGER

ALL_ROLES = [
    CODE_ENGINEER,
    LEGAL_REVIEWER,
    SECURITY_AUDITOR,
    UI_DESIGNER,
    DEVOPS_ENGINEER,
    TEST_ENGINEER,
    RESEARCHER,
    PROJECT_MANAGER,
]

ROLE_MAP = {role.id: role for role in ALL_ROLES}

__all__ = [
    "CODE_ENGINEER",
    "LEGAL_REVIEWER",
    "SECURITY_AUDITOR",
    "UI_DESIGNER",
    "DEVOPS_ENGINEER",
    "TEST_ENGINEER",
    "RESEARCHER",
    "PROJECT_MANAGER",
    "ALL_ROLES",
    "ROLE_MAP",
]
