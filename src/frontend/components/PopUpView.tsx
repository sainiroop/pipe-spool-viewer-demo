/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
/** @module KeyboardShortcut */

import * as React from "react";
import { GlobalContextMenu, ContextMenuItem, UiEvent } from "@bentley/ui-core";

export interface ViewRow {
  label: any;
}

export interface PopUpViewState {
  menuVisible: boolean;
  menuX: number;
  menuY: number;
  rows?: ViewRow[];
}

/** KeyboardShortcut Menu Event class.
 */
export class PopUpEvent extends UiEvent<PopUpViewState> { }

/** Widget State Changed Event class.
 */
export class PopUpView extends React.Component<{}, PopUpViewState> {

  /** @hidden */
  public readonly state: PopUpViewState = {
    menuVisible: false,
    menuX: 0,
    menuY: 0,
  };

  /** Get KeyboardShortcut Menu Event. */
  public static readonly onLinkPickerEvent = new PopUpEvent();

  public componentDidMount() {
    PopUpView.onLinkPickerEvent.addListener(this._handleLinkPickerEvent);
  }

  public componentWillUnmount() {
    PopUpView.onLinkPickerEvent.removeListener(this._handleLinkPickerEvent);
  }

  private _handleLinkPickerEvent = (state: PopUpViewState) => {
    this.setState(state);
  }

  public render(): React.ReactNode {
    const { rows, menuX, menuY, menuVisible } = this.state;
    const onClose = this._hideContextMenu;

    if (menuVisible) {
      const items = this.getLinkMenuItems(rows);

      return (
        <GlobalContextMenu
          identifier="popup-view"
          x={menuX}
          y={menuY}
          opened={menuVisible}
          onEsc={onClose}
          onOutsideClick={onClose}
          edgeLimit={false}
          autoflip={true}
        >
          {items}
        </GlobalContextMenu>
      );
    }

    return null;
  }

  private getLinkMenuItems(links?: any[]): React.ReactNode[] {
    const items: React.ReactNode[] = [];

    if (links) {
      links.forEach((link: any, index: number) => {
        const item = this.getLinkPickerItem(link, index);
        if (item)
          items.push(item);
      });
    }

    return items;
  }

  private getLinkPickerItem(link: any, index: number): React.ReactNode {

    const node = (
      <ContextMenuItem key={index} >
        {link.label}
      </ContextMenuItem>
    );

    return node;
  }

  private _hideContextMenu = () => {
    this.setState({ menuVisible: false, rows: undefined });
  }
}
