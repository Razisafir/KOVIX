// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_ADDITIONAL_TERMS.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls';

// ─── Agent View ──────────────────────────────────────────────────────────────────

export const AGENT_TITLE = localize('construct.agentTitle', "Kovix Agent");
export const AGENT_SUBTITLE = localize('construct.agentSubtitle', "AI-powered coding assistant");
export const AGENT_HINT = localize('construct.agentHint', "Ctrl+Shift+I  Inline edit  |  Ctrl+Shift+C  Focus panel");
export const PLACEHOLDER_ASK = localize('construct.placeholderAsk', "Ask Kovix anything...");
export const PLACEHOLDER_PLANNING = localize('construct.placeholderPlanning', "Planning...");
export const PLACEHOLDER_EXECUTING = localize('construct.placeholderExecuting', "Executing...");
export const PLACEHOLDER_AWAITING_APPROVAL = localize('construct.placeholderAwaitingApproval', "Awaiting approval...");
export const PLACEHOLDER_ERROR_RECOVERY = localize('construct.placeholderErrorRecovery', "An error occurred. Use the buttons below to recover.");
export const CONTEXT_LABEL = localize('construct.contextLabel', "Context:");
export const CONTEXT_FILE = localize('construct.contextFile', "File");
export const CONTEXT_WORKSPACE = localize('construct.contextWorkspace', "Workspace");
export const CONTEXT_SELECTION = localize('construct.contextSelection', "Selection");
export const CLEAR_CHAT = localize('construct.clearChat', "Clear chat");
export const SESSION_HISTORY = localize('construct.sessionHistory', "Session History");
export const SELECT_SESSION = localize('construct.selectSession', "Select a session to restore...");
export const NO_PREVIOUS_SESSIONS = localize('construct.noPreviousSessions', "No previous sessions found.");

// ─── Plan Review ─────────────────────────────────────────────────────────────────

export const UNCHECK_STEPS = localize('construct.uncheckSteps', "Uncheck any steps you want to skip");
export const SELECT_ALL = localize('construct.selectAll', "Select All");
export const DESELECT_ALL = localize('construct.deselectAll', "Deselect All");
export const REFINE_IDEA = localize('construct.refineIdea', "\u2190 Refine Idea");
export const APPROVE_AND_CONTINUE = localize('construct.approveAndContinue', "Approve & Continue \u2192");
export const CANCEL = localize('construct.cancel', "Cancel");

// ─── Error Recovery ──────────────────────────────────────────────────────────────

export const RETRY = localize('construct.retry', "Retry");
export const UNDO_CHANGES = localize('construct.undoChanges', "Undo Changes");
export const DISMISS = localize('construct.dismiss', "Dismiss");
export const NO_CHANGES_TO_UNDO = localize('construct.noChangesToUndo', "No changes to undo or undo failed.");
export const UNDO_FAILED = localize('construct.undoFailed', "Undo failed.");

// ─── Diff Viewer ─────────────────────────────────────────────────────────────────

export const LOADING_FILE_CONTENT = localize('construct.loadingFileContent', "Loading file content...");
export const UNABLE_TO_READ_FILE = localize('construct.unableToReadFile', "(Unable to read file content)");
export const ACCEPT = localize('construct.accept', "\u2705 Accept");
export const REJECT = localize('construct.reject', "\u274C Reject");

// ─── Idea Refinement ─────────────────────────────────────────────────────────────

export const IDEA_REFINEMENT = localize('construct.ideaRefinement', "\uD83D\uDCA1 Idea Refinement");
export const YOUR_ANSWER = localize('construct.yourAnswer', "Your answer...");
export const SUBMIT_ANSWER = localize('construct.submitAnswer', "Submit Answer");
export const SKIP_TO_PLANNING = localize('construct.skipToPlanning', "Skip to Planning");
export const PROCESSING_ANSWER = localize('construct.processingAnswer', "\u23F3 Processing your answer...");

// ─── Milestone Pause ─────────────────────────────────────────────────────────────

export const PAUSED_AT = localize('construct.pausedAt', "\u23F8 Paused at:");
export const CONTINUE = localize('construct.continue', "\u25B6 Continue");
export const SKIP = localize('construct.skip', "\u23ED Skip");
export const STOP = localize('construct.stop', "\u25A0 Stop");

// ─── Stop Mode Picker ────────────────────────────────────────────────────────────

export const MODE_EVERY_MILESTONE = localize('construct.modeEveryMilestone', "Every milestone");
export const MODE_EVERY_MILESTONE_BADGE = localize('construct.modeEveryMilestoneBadge', "Safest");
export const MODE_EVERY_MILESTONE_DESC = localize('construct.modeEveryMilestoneDesc', "Pause after each checkpoint. You review every stage before continuing.");
export const MODE_MAJOR_MILESTONE = localize('construct.modeMajorMilestone', "Major milestones");
export const MODE_MAJOR_MILESTONE_BADGE = localize('construct.modeMajorMilestoneBadge', "Recommended");
export const MODE_MAJOR_MILESTONE_DESC = localize('construct.modeMajorMilestoneDesc', "Pause at key completion points.");
export const MODE_SELECTIVE = localize('construct.modeSelective', "Selective milestones");
export const MODE_SELECTIVE_BADGE = localize('construct.modeSelectiveBadge', "Advanced");
export const MODE_SELECTIVE_DESC = localize('construct.modeSelectiveDesc', "Choose which checkpoints to pause at.");
export const MODE_FULL_AUTO = localize('construct.modeFullAuto', "Full auto");
export const MODE_FULL_AUTO_BADGE = localize('construct.modeFullAutoBadge', "Power users");
export const MODE_FULL_AUTO_DESC = localize('construct.modeFullAutoDesc', "Run everything. You can stop anytime.");
export const HOW_AUTONOMOUS = localize('construct.howAutonomous', "How autonomous should KOVIX be?");
export const BACK_TO_PLAN = localize('construct.backToPlan', "\u2190 Back to Plan");
export const EXECUTE = localize('construct.execute', "Execute \u2192");
export const CHANGES_WITHOUT_REVIEW = localize('construct.changesWithoutReview', "Changes will be applied without review");
export const NO_MAJOR_MILESTONES = localize('construct.noMajorMilestones', "(No major milestones detected)");
export const MAJOR_TAG = localize('construct.majorTag', "major");
export const SELECT_EXECUTION_MODE = localize('construct.selectExecutionMode', "Select execution mode");

// ─── Project Wizard ──────────────────────────────────────────────────────────────

export const STEP_NAME_PROJECT = localize('construct.stepNameProject', "Name Your Project");
export const STEP_DESCRIBE_IDEA = localize('construct.stepDescribeIdea', "Describe Your Idea");
export const STEP_TECH_STACK = localize('construct.stepTechStack', "Tech Stack");
export const STEP_SUCCESS_CRITERIA = localize('construct.stepSuccessCriteria', "Success Criteria");

export const STEP_SUBTITLE_NAME = localize('construct.stepSubtitleName', "Give your project a clear, memorable name.");
export const STEP_SUBTITLE_DESCRIBE = localize('construct.stepSubtitleDescribe', "What are you building? Share your vision.");
export const STEP_SUBTITLE_TECH = localize('construct.stepSubtitleTech', "Which technologies will you use?");
export const STEP_SUBTITLE_GOALS = localize('construct.stepSubtitleGoals', "What does success look like? Add at least one goal.");

export const PROJECT_NAME = localize('construct.projectName', "Project Name");
export const PROJECT_NAME_PLACEHOLDER = localize('construct.projectNamePlaceholder', "e.g. My Awesome App");
export const PROJECT_NAME_HINT = localize('construct.projectNameHint', "Required \u2014 max 80 characters");
export const PROJECT_DESCRIPTION = localize('construct.projectDescription', "Project Description");
export const PROJECT_DESCRIPTION_PLACEHOLDER = localize('construct.projectDescriptionPlaceholder', "Describe what you want to build, who it's for, and what problems it solves...");
export const PROJECT_DESCRIPTION_HINT = localize('construct.projectDescriptionHint', "Optional \u2014 but a good description helps the AI build exactly what you want.");
export const SELECTED_TECHNOLOGIES = localize('construct.selectedTechnologies', "Selected Technologies");
export const SUGGESTED_FROM_WORKSPACE = localize('construct.suggestedFromWorkspace', "SUGGESTED FROM WORKSPACE");
export const ADD_CUSTOM_TECHNOLOGY = localize('construct.addCustomTechnology', "ADD CUSTOM TECHNOLOGY");
export const CUSTOM_TECH_PLACEHOLDER = localize('construct.customTechPlaceholder', "e.g. React, Docker, GraphQL...");
export const ADD = localize('construct.add', "Add");
export const ADD_TECH_HINT = localize('construct.addTechHint', "Press Enter or click Add to include a technology.");
export const NO_TECH_SELECTED = localize('construct.noTechSelected', "No technologies selected yet");
export const DETECTING_TECH = localize('construct.detectingTech', "Detecting workspace technologies...");
export const ALL_TECH_ADDED = localize('construct.allTechAdded', "All detected technologies added");
export const GOALS = localize('construct.goals', "Goals");
export const GOAL_PLACEHOLDER = localize('construct.goalPlaceholder', "Type a goal and press Enter...");
export const NO_GOALS_YET = localize('construct.noGoalsYet', "No goals yet. Type one below and press Enter.");
export const PREVIOUS = localize('construct.previous', "\u2190 Previous");
export const NEXT = localize('construct.next', "Next \u2192");
export const CREATE_PROJECT = localize('construct.createProject', "\u2713 Create Project");
export const CREATING = localize('construct.creating', "Creating...");

// ─── Memory Editor ───────────────────────────────────────────────────────────────

export const MEMORY_TITLE_PLACEHOLDER = localize('construct.memoryTitlePlaceholder', "Memory title...");
export const PREVIEW = localize('construct.preview', "Preview");
export const EDIT = localize('construct.edit', "Edit");
export const CATEGORY = localize('construct.category', "Category");
export const TAGS = localize('construct.tags', "Tags");
export const ADD_TAG_PLACEHOLDER = localize('construct.addTagPlaceholder', "Add tag, press Enter...");
export const MEMORY_CONTENT_PLACEHOLDER = localize('construct.memoryContentPlaceholder', "Write your memory content here... (Markdown supported)");
export const SAVE = localize('construct.save', "Save");
export const DISCARD_CHANGES = localize('construct.discardChanges', "Discard Changes");
export const DELETE_MEMORY = localize('construct.deleteMemory', "Delete Memory");
