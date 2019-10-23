/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
import * as React from "react";
import { Id64String, OpenMode } from "@bentley/bentleyjs-core";
import { AccessToken, ConnectClient, IModelQuery, Project, Config } from "@bentley/imodeljs-clients";
import { IModelApp, IModelConnection, FrontendRequestContext, AuthorizedFrontendRequestContext, SpatialModelState, SelectionSetEvent } from "@bentley/imodeljs-frontend";
import { Presentation, SelectionChangeEventArgs, ISelectionProvider } from "@bentley/presentation-frontend";
import { Button, ButtonSize, ButtonType, Spinner, SpinnerSize } from "@bentley/ui-core";
import { SignIn } from "@bentley/ui-components";
import { SimpleViewerApp } from "../api/SimpleViewerApp";
import PropertiesWidget from "./Properties";
import GridWidget from "./Table";
import TreeWidget from "./Tree";
import ViewportContentControl from "./Viewport";
import "@bentley/icons-generic-webfont/dist/bentley-icons-generic-webfont.css";
import * as querystring from "querystring";
import * as url from "url";
import "./App.css";
import { RenderMode, ModelQueryParams, ModelProps } from "@bentley/imodeljs-common";
import { PopUpView } from "./PopUpView";

// tslint:disable: no-console
// cSpell:ignore imodels

/** React state of the App component */
export interface AppState {
  user: {
    accessToken?: AccessToken;
    isLoading?: boolean;
  };
  offlineIModel: boolean;
  imodel?: IModelConnection;
  viewDefinitionId?: Id64String;
  spoolHighlightSet?: string[];
}

/** A component the renders the whole application UI */
export default class App extends React.Component<{}, AppState> {

  /** Creates an App instance */
  constructor(props?: any, context?: any) {
    super(props, context);
    this.state = {
      user: {
        isLoading: false,
        accessToken: undefined,
      },
      offlineIModel: false,
    };
  }

  public componentDidMount() {
    // subscribe for unified selection changes
    Presentation.selection.selectionChange.addListener(this._onSelectionChanged);

    // Initialize authorization state, and add listener to changes
    SimpleViewerApp.oidcClient.onUserStateChanged.addListener(this._onUserStateChanged);
    if (SimpleViewerApp.oidcClient.isAuthorized) {
      SimpleViewerApp.oidcClient.getAccessToken(new FrontendRequestContext()) // tslint:disable-line: no-floating-promises
        .then((accessToken: AccessToken | undefined) => {
          this.setState((prev) => ({ user: { ...prev.user, accessToken, isLoading: false } }));
        });
    }
  }

  public componentWillUnmount() {
    // unsubscribe from unified selection changes
    Presentation.selection.selectionChange.removeListener(this._onSelectionChanged);
    // unsubscribe from user state changes
    SimpleViewerApp.oidcClient.onUserStateChanged.removeListener(this._onUserStateChanged);
  }

  private _onSelectionChanged = (evt: SelectionChangeEventArgs, selectionProvider: ISelectionProvider) => {
    const selection = selectionProvider.getSelection(evt.imodel, evt.level);
    if (selection.isEmpty) {
      console.log("========== Selection cleared ==========");
    } else {
      console.log("========== Selection change ===========");
      if (selection.instanceKeys.size !== 0) {
        // log all selected ECInstance ids grouped by ECClass name
        console.log("ECInstances:");
        selection.instanceKeys.forEach((ids, ecclass) => {
          console.log(`${ecclass}: [${[...ids].join(",")}]`);
        });
      }
      if (selection.nodeKeys.size !== 0) {
        // log all selected node keys
        console.log("Nodes:");
        selection.nodeKeys.forEach((key) => console.log(JSON.stringify(key)));
      }
      console.log("=======================================");
    }
  }

  private turnOnAllCategories(imodel: IModelConnection): any {
    IModelApp.viewManager.onViewOpen.addOnce(async () => {
      IModelApp.viewManager.forEachViewport((vp) => {
        vp.onViewChanged.addOnce(async () => {
          const selectUsedSpatialCategoryIds = "SELECT DISTINCT Category.Id as id from BisCore.GeometricElement3d WHERE Category.Id IN (SELECT ECInstanceId from BisCore.SpatialCategory)";
          const ecsql2 = "SELECT ECInstanceId as id FROM BisCore.SpatialCategory WHERE ECInstanceId IN (" + selectUsedSpatialCategoryIds + ")";
          const categories: string[] = [];
          vp.view.viewFlags.renderMode = RenderMode.SmoothShade;
          for await (const row of imodel.query(ecsql2)) categories.push(row.id);
          for (const category of categories) vp.changeCategoryDisplay(category, true, true);

          const modelQueryParams: ModelQueryParams = { from: SpatialModelState.classFullName, wantPrivate: false };
          const curModelProps: ModelProps[] = await imodel.models.queryProps(modelQueryParams);
          curModelProps;
          const modelIds: Id64String[] = [];
          for (const modelProps of curModelProps) if (modelProps.id) modelIds.push(modelProps.id as Id64String);
          vp.addViewedModels(modelIds);
        });
      });
    });
  }

  private addPopUpListener(imodel: IModelConnection) {
    imodel.selectionSet.onChanged.addListener((ev: SelectionSetEvent) => {
      ev;
    });
  }

  private _onRegister = () => {
    window.open("https://imodeljs.github.io/iModelJs-docs-output/getting-started/#developer-registration", "_blank");
  }

  private _onOffline = () => {
    this.setState((prev) => ({ user: { ...prev.user, isLoading: false }, offlineIModel: true }));
  }

  private _onStartSignin = async () => {
    this.setState((prev) => ({ user: { ...prev.user, isLoading: true } }));
    await SimpleViewerApp.oidcClient.signIn(new FrontendRequestContext());
  }

  private _onUserStateChanged = (accessToken: AccessToken | undefined) => {
    this.setState((prev) => ({ user: { ...prev.user, accessToken, isLoading: false } }));
  }

  /** Pick the first available spatial view definition in the imodel */
  private async getFirstViewDefinitionId(imodel: IModelConnection): Promise<Id64String> {
    const viewSpecs = await imodel.views.queryProps({});
    const acceptedViewClasses = [
      "BisCore:SpatialViewDefinition",
      "BisCore:DrawingViewDefinition",
    ];
    const acceptedViewSpecs = viewSpecs.filter((spec) => (-1 !== acceptedViewClasses.indexOf(spec.classFullName)));
    if (0 === acceptedViewSpecs.length)
      throw new Error("No valid view definitions in imodel");

    // Prefer spatial view over drawing.
    const spatialViews = acceptedViewSpecs.filter((v) => {
      return v.classFullName === "BisCore:SpatialViewDefinition";
    });

    if (spatialViews.length > 0)
      return spatialViews[0].id!;

    return acceptedViewSpecs[0].id!;
  }

  private getListOfSpoolsFromUrl() {
    const query = url.parse(document.URL).query;
    const urlParams: any = query ? querystring.parse(query.toString()) : undefined;
    return urlParams ? urlParams.spools ? urlParams.spools.split(" ") : undefined : undefined;
  }

  /** Handle iModel open event */
  private _onIModelSelected = async (imodel: IModelConnection | undefined) => {
    if (!imodel) {
      // reset the state when imodel is closed
      this.setState({ imodel: undefined, viewDefinitionId: undefined });
      return;
    }
    try {
      this.turnOnAllCategories(imodel);
      this.addPopUpListener(imodel);
      const spoolHighlightSet = this.getListOfSpoolsFromUrl();
      // attempt to get a view definition
      const viewDefinitionId = imodel ? await this.getFirstViewDefinitionId(imodel) : undefined;
      this.setState({ imodel, viewDefinitionId, spoolHighlightSet });

    } catch (e) {
      // if failed, close the imodel and reset the state
      if (this.state.offlineIModel) {
        await imodel.closeSnapshot();
      } else {
        await imodel.close();
      }
      this.setState({ imodel: undefined, viewDefinitionId: undefined });
      alert(e.message);
    }
  }

  private get _signInRedirectUri() {
    const split = (Config.App.get("imjs_browser_test_redirect_uri") as string).split("://");
    return split[split.length - 1];
  }

  /** The component's render method */
  public render() {
    let ui: React.ReactNode;

    if (this.state.user.isLoading || window.location.href.includes(this._signInRedirectUri)) {
      // if user is currently being loaded, just tell that
      ui = `${IModelApp.i18n.translate("SimpleViewer:signing-in")}...`;
    } else if (!this.state.user.accessToken && !this.state.offlineIModel) {
      // if user doesn't have and access token, show sign in page
      ui = (<SignIn onSignIn={this._onStartSignin} onRegister={this._onRegister} onOffline={this._onOffline} />);
    } else if (!this.state.imodel || !this.state.viewDefinitionId) {
      // if we don't have an imodel / view definition id - render a button that initiates imodel open
      ui = (<OpenIModelButton accessToken={this.state.user.accessToken} offlineIModel={this.state.offlineIModel} onIModelSelected={this._onIModelSelected} />);
    } else if (this.state.spoolHighlightSet) {
      // if we do have an imodel and view definition id - render imodel components
      ui = (<IModelComponents imodel={this.state.imodel} viewDefinitionId={this.state.viewDefinitionId} spoolHighlightSet={this.state.spoolHighlightSet} />);
    } else throw new Error("Cannot find SPOOL data in URL.");

    // render the app
    return (
      <div className="app">
        <div className="app-header">
          <h2>{IModelApp.i18n.translate("SimpleViewer:welcome-message")}</h2>
        </div>
        {ui}
      </div>
    );
  }
}

/** React props for [[OpenIModelButton]] component */
interface OpenIModelButtonProps {
  accessToken: AccessToken | undefined;
  offlineIModel: boolean;
  onIModelSelected: (imodel: IModelConnection | undefined) => void;
}
/** React state for [[OpenIModelButton]] component */
interface OpenIModelButtonState {
  isLoading: boolean;
}
/** Renders a button that opens an iModel identified in configuration */
class OpenIModelButton extends React.PureComponent<OpenIModelButtonProps, OpenIModelButtonState> {
  public state = { isLoading: false };

  /** Finds project and imodel ids using their names */
  private async getIModelInfo(): Promise<{ projectId: string, imodelId: string }> {
    const projectName = Config.App.get("imjs_test_project");
    const imodelName = Config.App.get("imjs_test_imodel");

    const requestContext: AuthorizedFrontendRequestContext = await AuthorizedFrontendRequestContext.create();

    const connectClient = new ConnectClient();
    let project: Project;
    try {
      project = await connectClient.getProject(requestContext, { $filter: `Name+eq+'${projectName}'` });
    } catch (e) {
      throw new Error(`Project with name "${projectName}" does not exist`);
    }

    const imodelQuery = new IModelQuery();
    imodelQuery.byName(imodelName);
    const imodels = await IModelApp.iModelClient.iModels.get(requestContext, project.wsgId, imodelQuery);
    if (imodels.length === 0)
      throw new Error(`iModel with name "${imodelName}" does not exist in project "${projectName}"`);
    return { projectId: project.wsgId, imodelId: imodels[0].wsgId };
  }

  /** Handle iModel open event */
  private async onIModelSelected(imodel: IModelConnection | undefined) {
    this.props.onIModelSelected(imodel);
    this.setState({ isLoading: false });
  }

  private _onClick = async () => {
    this.setState({ isLoading: true });
    let imodel: IModelConnection | undefined;
    try {
      // attempt to open the imodel
      if (this.props.offlineIModel) {
        const offlineIModel = Config.App.getString("imjs_offline_imodel");
        imodel = await IModelConnection.openSnapshot(offlineIModel);
      } else {
        const info = await this.getIModelInfo();
        imodel = await IModelConnection.open(info.projectId, info.imodelId, OpenMode.Readonly);
      }
    } catch (e) {
      alert(e.message);
    }
    await this.onIModelSelected(imodel);
  }

  public render() {
    return (
      <Button size={ButtonSize.Large} buttonType={ButtonType.Primary} className="button-open-imodel" onClick={this._onClick}>
        <span>{IModelApp.i18n.translate("SimpleViewer:components.imodel-picker.open-imodel")}</span>
        {this.state.isLoading ? <span style={{ marginLeft: "8px" }}><Spinner size={SpinnerSize.Small} /></span> : undefined}
      </Button>
    );
  }
}

/** React props for [[IModelComponents]] component */
interface IModelComponentsProps {
  imodel: IModelConnection;
  viewDefinitionId: Id64String;
  spoolHighlightSet: string[];
}
/** Renders a viewport, a tree, a property grid and a table */
class IModelComponents extends React.PureComponent<IModelComponentsProps> {

  private _getSpoolForElementWithId = async (ecInstanceId: string) => {
    const rows = [];

    const query = `SELECT spool AS spool FROM SPxReviewDynamic.P3DPipe
      WHERE ECInstanceId = ${ecInstanceId}
      UNION SELECT spool AS spool FROM SPxReviewDynamic.P3DPipeInstrument
      WHERE ECInstanceId = ${ecInstanceId}
      UNION SELECT spool AS spool FROM SPxReviewDynamic.P3DPipingComponent
      WHERE ECInstanceId = ${ecInstanceId}`;

    for await (const row of this.props.imodel.query(query)) rows.push(row);
    return rows.length > 0 ? rows[0].spool : undefined;
  }

  private _onViewportClick = (ev: React.MouseEvent) => {
    const x = ev.clientX; const y = ev.clientY;

    this.props.imodel.selectionSet.onChanged.addOnce(async () => {
      const elementId = await this.props.imodel.selectionSet.elements.values().next();
      const spool = await this._getSpoolForElementWithId(elementId.value);

      const rows = [{label: "Elemend Id: " + elementId.value}];
      spool ? rows.push({label: "Spool: " + spool}) : undefined;

      if (elementId.value) {
        const offset = 8;
        PopUpView.onLinkPickerEvent.emit({
          menuVisible: true,
          menuX: x - offset,
          menuY: y - offset,
          rows,
        });
      }
    });
  }

  public render() {
    // ID of the presentation ruleset used by all of the controls; the ruleset
    // can be found at `assets/presentation_rules/Default.PresentationRuleSet.xml`
    const rulesetId = "Default";
    return (
      <div className="app-content">
        <div className="top-left" onClick={this._onViewportClick}>
          <ViewportContentControl imodel={this.props.imodel} rulesetId={rulesetId} viewDefinitionId={this.props.viewDefinitionId}/>
        </div>
        <div className="right">
          <div className="top">
            <TreeWidget imodel={this.props.imodel} rulesetId={rulesetId} />
          </div>
          <div className="bottom">
            <PropertiesWidget imodel={this.props.imodel} rulesetId={rulesetId} />
          </div>
        </div>
        <div className="bottom">
          <GridWidget imodel={this.props.imodel} highlightSet={this.props.spoolHighlightSet}/>
        </div>
      <PopUpView />
      </div>
    );
  }
}
