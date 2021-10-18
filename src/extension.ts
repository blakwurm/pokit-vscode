// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import * as express from 'express';

let editor: vscode.WebviewPanel;
let ctx: vscode.ExtensionContext;
let disposed = true;

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

function startEditor() {
	let folders = vscode.workspace.workspaceFolders;
	if(!folders) {
		vscode.window.showErrorMessage("Must have active workspace to edit cart")
		return;
	}

	const workspace = folders[0].uri.fsPath;
	const entityFolder = path.join(workspace, 'entities');
	const sceneFolder = path.join(workspace, 'scenes')

	if(!fs.existsSync(path.join(workspace, 'cart.json'))) {
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
		createEditor();
		disposed = false;
	} else {
		editor.reveal();
	}
}

function createServerEditor() {
	const app = express();
	let root = path.join(ctx.extensionPath, 'pokit-web-editor', 'public');
	app.use(express.static(root))
	app.listen(8888);
	editor.webview.html = `<html><script type="text/javascript">s
		window.location.replace("http://localhost:8888/");
		</script></html>`;
}

function createEditor() {
	let j = path.join;
	let tools = j(ctx.extensionPath, 'pokit-web-editor', 'public');
	let build = j(tools, 'build');
	let js = j(build, 'bundle.js');
	let buildcss = prepareCss(build, 'bundle.css');
	let globalcss = prepareCss(tools, 'global.css');
	editor.webview.html = getPageSrc(js,globalcss,buildcss);
}

function prepareCss(root: string, file: string) {
	let p = path.join(root, file);
	let txt = fs.readFileSync(p, 'utf-8');
	return txt.replace(/(?:url\('(?<url>.*(?='))'\))/, (t,url)=>{
		let n = path.join(root,url);
		let uri = vscode.Uri.file(n);
		let webUri = editor.webview.asWebviewUri(uri).toString();
		return `url('${webUri}')`
	});
}

function getPageSrc(js: string, globalcss: string, buildcss: string) {
	let uri = vscode.Uri.file
	let jsUri = editor.webview.asWebviewUri(uri(js)).toString();

	return `<!DOCTYPE html>
<html lang="en">
	<script>
		if (!window.process) {
			window.process = {env: {NODE_ENV:"production"}}
		}
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

// this method is called when your extension is deactivated
export function deactivate() {}
