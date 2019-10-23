/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
import * as React from "react";
import { Table, SimpleTableDataProvider, ColumnDescription, RowItem, SelectionMode } from "@bentley/ui-components";
import { PropertyRecord, PropertyValue, PropertyValueFormat, PropertyDescription, IModelConnection, IModelApp, EmphasizeElements, Viewport } from "@bentley/imodeljs-frontend";
import { delay } from "q";

export interface Props {
  /** Custom property pane data provider. */
  highlightSet: any[];
  imodel: IModelConnection;
}

/** Table component for the viewer app */
export default class SimpleTableComponent extends React.PureComponent<Props> {

  private _spools: string[] = [];

  public componentDidMount() {
    this._spools = this.props.highlightSet;
    this._updateViewport();
  }

  private async _getElementsForSpools(): Promise<any[]> {
    let spoolList = "(";
    const count = this._spools.length;
    // prepare list of component ids
    this._spools.forEach((value: any, index: number) => {
      spoolList += "'" + value + "'";
      spoolList += (++index !== count) ? ", " : ")";
    });

    const query = `SELECT ECInstanceId AS id FROM SPxReviewDynamic.P3DPipe
      WHERE Spool IN ${spoolList}
      UNION SELECT ECInstanceId AS id FROM SPxReviewDynamic.P3DPipeInstrument
      WHERE Spool IN ${spoolList}
      UNION SELECT ECInstanceId AS id FROM SPxReviewDynamic.P3DPipingComponent
      WHERE Spool IN ${spoolList}`;

    const elements: any[] = [];
    if (this._spools.length > 0) for await (const row of this.props.imodel.query(query)) elements.push(row.id);

    return elements;
  }

  private async _updateViewport() {
    const elements = await this._getElementsForSpools();
    const vp = IModelApp.viewManager.selectedView;
    vp ? this.isolateAndZoom(elements, vp) : IModelApp.viewManager.onViewOpen.addOnce((_vp) => this.isolateAndZoom(elements, _vp, true));
    }

  private async isolateAndZoom(elements: any[], vp: Viewport, wait?: boolean) {
    const emphasize = EmphasizeElements.getOrCreate(vp);
    if (elements.length > 0) {
      emphasize.clearHiddenElements(vp);
      emphasize.isolateElements(elements, vp, true);
    } else emphasize.hideElements(emphasize.getAlwaysDrawnElements(vp)!, vp);
    wait ? await delay(500) : undefined;
    vp.zoomToElements(elements);
  }

  private _isRowSelected = (_row: RowItem) => {
    return true;
  }

  private _onRowsSelected = async (rowIterator: AsyncIterableIterator<RowItem>) => {

    let row = await rowIterator.next();

    while (!row.done) {
      const spoolID = (row.value.cells[0].record!.value as any).value;
      this._spools.push(spoolID);
      row = await rowIterator.next();
    }

    this._updateViewport();

    return Promise.resolve(true);
  }

  private _onRowsDeselected = async (rowIterator: AsyncIterableIterator<RowItem>) => {

    let row = await rowIterator.next();

    while (!row.done) {
      const spoolID = (row.value.cells[0].record!.value as any).value;
      const index = this._spools.indexOf(spoolID);
      this._spools.splice(index, 1);
      row = await rowIterator.next();
    }

    this._updateViewport();

    return Promise.resolve(true);
  }

  private _getDataProvider = (): SimpleTableDataProvider => {

    const columns: ColumnDescription[] = [];

    columns.push({key: "spool_id", label: "SPOOL ID" });

    const dataProvider: SimpleTableDataProvider = new SimpleTableDataProvider(columns);

    this.props.highlightSet.forEach((rowValue: any, index) => {
      const rowItem: RowItem = {key: index.toString(), cells: []};
      const value: PropertyValue = {valueFormat: PropertyValueFormat.Primitive, value: rowValue};
      const description: PropertyDescription = {displayLabel: columns[0].label, name: columns[0].key, typename: "string"};
      rowItem.cells.push({key: columns[0].key, record: new PropertyRecord(value, description)});
      dataProvider.addRow(rowItem);
    });

    return dataProvider;
  }

  public render() {
    return (
      <div style={{ height: "100%" }}>
        <Table dataProvider={this._getDataProvider()} selectionMode={SelectionMode.Multiple} onRowsSelected={this._onRowsSelected} onRowsDeselected={this._onRowsDeselected} isRowSelected={this._isRowSelected}/>
      </div>
    );
  }
}
