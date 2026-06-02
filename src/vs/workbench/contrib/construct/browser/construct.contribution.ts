/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Main Contribution
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IViewsRegistry, Extensions as ViewExtensions } from '../../../../workbench/common/views.js';
import { IViewContainersRegistry, ViewContainerLocation } from '../../../../workbench/common/views.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../../workbench/browser/parts/views/viewPaneContainer.js';
import { ConstructAgentViewPane } from './constructAgentView.js';

const constructViewIcon = registerIcon('construct-view-icon', Codicon.robot, localize('constructViewIcon', 'View icon of the Construct Agent view.'));

// Register the Construct view container in the sidebar
const constructViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: 'construct',
	title: localize2('construct', "Construct Agent"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['construct', { mergeViewWithContainerWhenSingleView: true }]),
	icon: constructViewIcon,
	order: 100,
}, ViewContainerLocation.Sidebar, { doNotRegisterOpenCommand: false });

// Register the agent panel view inside the container
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: 'construct.agentPanel',
	name: localize2('agentPanel', "Agent"),
	containerIcon: constructViewIcon,
	ctorDescriptor: new SyncDescriptor(ConstructAgentViewPane),
	canToggleVisibility: true,
	canMoveView: true,
	order: 1,
}], constructViewContainer);
