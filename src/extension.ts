// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {join as j} from 'path';
import { CartManifest, EntityStub, SceneStub } from './pokit.types';

let editor: vscode.WebviewPanel;
let ctx: vscode.ExtensionContext;
let workspace = "";
let disposed = true;
let watching = false;

let entities: Record<string,EntityStub> = {};
let scenes: Record<string,EntityStub> = {};

enum ToolType {
	BRUSH,
	SELECT,
	PAN
}

export interface AppData {
	handling?: boolean
	manifest: CartManifest
	entities: Record<string, EntityStub>
	scenes: Record<string, SceneStub>
	currentScene: string
	currentBrush: string
	currentTool: ToolType
	inspecting: [string, string, number]
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	ctx = context;	
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('pokit-vscode.editor', startEditor);

	context.subscriptions.push(disposable);
}

function makeFileSystemWatchers(workspace: string, entities: string, scenes: string) {
	let cartWatcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(workspace, "cart.json")
	);
	let entityWatcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(entities, "*.json")
	);
	let sceneWatcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(scenes, "*.json")
	);
	cartWatcher.onDidChange(onCartChange);
	entityWatcher.onDidCreate(onEntityChange);
	entityWatcher.onDidChange(onEntityChange);
	entityWatcher.onDidDelete(onEntityDelete);
	sceneWatcher.onDidCreate(onSceneChange);
	sceneWatcher.onDidChange(onSceneChange);
	sceneWatcher.onDidDelete(onSceneDelete);
	watching = true;
}

function sendEvent(evt: string, name: string, data?: any ) {
	if(disposed)return;
	editor.webview.postMessage({evt,name,data})
}

function getName(uri: vscode.Uri) {
	let split = uri.toJSON().path.split('/');
	let fileSplit = split[split.length-1].split('.');
	return fileSplit[fileSplit.length-2];
}

async function loadUri(uri: vscode.Uri) {
	let c = await vscode.workspace.fs.readFile(uri)
	return c.toString();
}

async function loadJsonUri(uri: vscode.Uri, defaults?: any) {
	defaults = defaults || {};
	let str = await loadUri(uri);
	try {
		let data = JSON.parse(str);
		return Object.assign(defaults, data);
	} catch {
		return;
	}
}

async function onCartChange(f: vscode.Uri) {
	let data = await loadJsonUri(f);
	if(!data)return;
	let name = getName(f);
	sendEvent("cart_change", name, data);
}

async function onEntityChange(f: vscode.Uri) {
	let name = getName(f);
	let data = await loadJsonUri(f, {
		inherits: [],
		components: {},
		timestamp: Date.now()
	})
	if(!data) return;
	entities[name] = data;
	sendEvent("entity_change", name, data);
}

async function onEntityDelete(f: vscode.Uri) {
	let name = getName(f);
	delete entities[name]
	sendEvent("entity_delete", name);
}

async function onSceneChange(f: vscode.Uri) {
	let name = getName(f);
	let data = await loadJsonUri(f, {
		systems: [],
		entities: {},
		timestamp: Date.now()
	});
	if(!data) return;
	scenes[name] = data;
	sendEvent("scene_change", name, data);
}

async function onSceneDelete(f: vscode.Uri) {
	let name = getName(f);
	delete scenes[name];
	sendEvent("scene_delete", name);
}

async function startEditor() {
	let folders = vscode.workspace.workspaceFolders;
	if(!folders) {
		vscode.window.showErrorMessage("Must have active workspace to edit cart")
		return;
	}

	workspace = folders[0].uri.fsPath;
	const entityFolder = j(workspace, 'entities');
	const sceneFolder = j(workspace, 'scenes')

	if(!await exists(vscode.Uri.file(j(workspace, 'cart.json')))) {
		vscode.window.showErrorMessage("Workspace does not have valid cart.json")
		return;
	}

	if(disposed) {
		editor = vscode.window.createWebviewPanel(
			'pokitEditor',
			'Pokit Editor',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		)
		editor.onDidDispose(()=>disposed=true);
		createEditor(workspace, entityFolder, sceneFolder);
		disposed = false;
	} else {
		editor.reveal();
	}
}

async function createEditor(workspace: string, entityFolder: string, sceneFolder: string) {
	let tools = j(ctx.extensionPath, 'pokit-web-editor', 'public');
	let build = j(tools, 'build');
	let js = j(build, 'bundle.js');
	let buildcss = await prepareCss(build, 'bundle.css');
	let globalcss = await prepareCss(tools, 'global.css');
	editor.webview.onDidReceiveMessage(onStateUpdate);
	let state = await initEditorState(workspace);
	editor.webview.html = getPageSrc(js,globalcss,buildcss,state);
	if(!watching) makeFileSystemWatchers(workspace, entityFolder, sceneFolder);
}

async function onStateUpdate(msg: AppData) {
	if(msg.handling)return;
	delete msg.entities['__DEFAULT_PARENT__']
	let {del:edel, change:echange} = getChanges(entities, msg.entities);
	let {del:sdel, change:schange} = getChanges(scenes, msg.scenes);
	let entityPath = j(workspace, 'entities');
	let scenePath = j(workspace, 'scenes');
	for(let [k,v] of Object.entries(echange)) {
		await updateFile(entityPath, k, v);
		entities[k] = v;
	}
	for(let [k,v] of Object.entries(schange)) {
		await updateFile(scenePath, k, v);
		scenes[k] = v;
	}
	await updateCart();
}

async function updateCart() {
	let cartPath = j(workspace, 'cart.json');
	let uri = vscode.Uri.file(cartPath);
	let file = await vscode.workspace.openTextDocument(uri);
	let obj: CartManifest = JSON.parse(file.getText());
	let cartEntities = obj.entityShards;
	let cartScenes = obj.sceneShards;
	let memEntities = [...Object.keys(entities)].map(e=>e+".json");
	let memScenes = [...Object.keys(scenes)].map(s=>s+".json");
	if(diff(cartEntities.sort(), memEntities.sort()) || diff(cartScenes.sort(), memScenes.sort())) {
		obj.entityShards = memEntities;
		obj.sceneShards = memScenes;
		updateFile(workspace, "cart", obj);
	}
}

async function exists(uri: vscode.Uri) {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	}
	catch {
		return false;
	}
}

async function updateFile(root: string, name: string, content: any) {
	let uri = vscode.Uri.file(j(root,name+'.json'));
	let txt = JSON.stringify(content, null, 2);
	if(!await exists(uri)) {
		await vscode.workspace.fs.writeFile(uri, new Uint8Array());
	}
	let panel = await vscode.window.showTextDocument(uri,{preserveFocus:true, viewColumn:vscode.ViewColumn.One});
	panel.edit(e=>{
		e.delete(new vscode.Range(new vscode.Position(0,0), new vscode.Position(Infinity,Infinity)));
		e.insert(new vscode.Position(0,0), txt);
	});
}

function deleteFile(path: string, name: string) {

}

async function prepareCss(root: string, file: string) {
	let p = j(root, file);
	let txt = await loadUri(vscode.Uri.file(p));
	return txt.replace(/(?:url\('(?<url>.*(?='))'\))/, (t,url)=>{
		let n = j(root,url);
		let uri = vscode.Uri.file(n);
		let webUri = editor.webview.asWebviewUri(uri).toString();
		return `url('${webUri}')`
	});
}

function getPageSrc(js: string, globalcss: string, buildcss: string, state: string) {
	let uri = vscode.Uri.file
	let jsUri = editor.webview.asWebviewUri(uri(js)).toString();

	return `<!DOCTYPE html>
<html lang="en">
	<script>
		if (!window.process) {
			window.process = {env: {NODE_ENV:"production"}}
		}
		window.__pokit_state=JSON.parse(\`${state}\`);
	</script>
<head>
	<meta charset='utf-8'>
	<meta name='viewport' content='width=device-width,initial-scale=1'>

	<title>Alex can suck it</title>

	<style>${globalcss}</style>
	<style>${buildcss}</style>
	<script defer src='${jsUri}'></script>
</head>

<body>
</body>
</html>

`;
}

async function initEditorState(ws: string) {
	let uri = vscode.Uri.file;
	let entityFolder = uri(j(ws, 'entities'));
	let sceneFolder = uri(j(ws, 'scenes'));
	let manifestPath = uri(j(ws, 'cart.json'));
	let spritesPath = uri(j(ws, 'sprites.png'));
	let fs = vscode.workspace.fs;
	let manifestBytes = await fs.readFile(manifestPath);
	let spritesBytes = await fs.readFile(spritesPath);
	let manifest = JSON.parse(manifestBytes.toString());
	let entityFiles = await fs.readDirectory(entityFolder);
	let sceneFiles = await fs.readDirectory(sceneFolder);
	entities = {};
	scenes = {};
	for(let [file, type] of entityFiles) {
		let split = file.split('.');
		if(type === 1 && split[split.length-1] === 'json') {
			let name = split.slice(0, -1).join('.');
			let fileUri = uri(j(ws, 'entities', file));
			let eString = (await fs.readFile(fileUri)).toString();
			let e = JSON.parse(eString);
			e = Object.assign({
				inherits: [],
				components: {},
				timestamp: Date.now()
			},e)
			entities[name] = e;
		}
	}
	for(let [file, type] of sceneFiles) {
		let split = file.split('.');
		if(type === 1 && split[split.length-1] === 'json') {
			let name = split.slice(0, -1).join('.');
			let fileUri = uri(j(ws, 'scenes', file));
			let sString = (await fs.readFile(fileUri)).toString();
			let s = JSON.parse(sString);
			s = Object.assign({
				systems: [],
				entities: {},
				timestamp: Date.now()
			},s)
			scenes[name] = s;
		}
	}
	await updateCart();
	return JSON.stringify({
		state: {
			manifest,
			entities,
			scenes,
			currentScene: manifest.defaultScene,
			currentBrush: [...Object.keys(entities)][0],
			currentTool: ToolType.SELECT,
			inspecting: ["",0,0],

		},
		spritemap: Buffer.from(spritesBytes).toString('base64')
	})
}
let logDiff = false;
function getChanges(original: Record<string,any>, modified: Record<string,any>) {
	let keys = new Set([...Object.keys(original),...Object.keys(modified)]);
	let del = new Set<string>();
	let change: Record<string,any> = {};
	for(let k of keys) {
		if(!(k in modified)) del.add(k);
		else if(!(k in original) || diff(original[k], modified[k])) change[k] = modified[k];
	}
	return {del,change};
}

function diff(original: any, modified: any) {
	if(Array.isArray(original)) {
		if(original.length !== modified.length) {if(logDiff)console.log('Array length mismatch'); return true; }
		for(let i in original) {
			if(typeof original[i] !== typeof modified[i]) {if(logDiff)console.log('types:', typeof original[i], 'and',typeof modified[i], 'dont match');return true};
			if(typeof original[i] === 'object') {
				if(diff(original[i], modified[i])) return true;
			}
			else if(original[i] !== modified[i]) {if(logDiff)console.log('values:',original[i],'and',modified[i],'dont match');return true};
		}
		return false;
	}
	let keys = new Set([...Object.keys(original),...Object.keys(modified)]);
	for(let k of keys) {
		if(!(k in original) || !(k in modified)){ if(logDiff)console.log(k,'not present in both objects'); return true; }
		if(typeof original[k] !== typeof modified[k]){ if(logDiff)console.log(k, 'types:', typeof original[k], 'and', typeof modified[k], 'do not match'); return true; }
		if(typeof original[k] === 'object') {
			if(diff(original[k], modified[k])){ return true; }
		}
		else if(original[k]!==modified[k]){ if(logDiff)console.log(k, 'values:', original[k], 'and', modified[k], 'do not match'); return true; }
	}
	return false;
}

// this method is called when your extension is deactivated
export function deactivate() {}
