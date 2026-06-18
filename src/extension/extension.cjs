const path = require("node:path");
const vscode = require("vscode");

let corePromise;

function loadCore() {
  if (!corePromise) corePromise = import("../core.js");
  return corePromise;
}

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function requireWorkspace() {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage("ForgeMind: open a workspace folder first.");
    throw new Error("Open a workspace folder first.");
  }
  return root;
}

function maxFileSizeKb() {
  return vscode.workspace.getConfiguration("forgemind").get("maxFileSizeKb", 300);
}

function contextPackMaxSizeKb() {
  return vscode.workspace.getConfiguration("forgemind").get("contextPack.maxSizeKb", 40);
}

function sessionTracking() {
  return { enabled: vscode.workspace.getConfiguration("forgemind").get("sessionTracking.enabled", true) };
}

async function handleCommand(output, action) {
  try {
    const core = await loadCore();
    const logger = core.createLogger({
      root: workspaceRoot() ?? process.cwd(),
      sink: {
        log: (message) => output.appendLine(message),
        warn: (message) => output.appendLine(message),
        error: (message) => output.appendLine(message)
      }
    });
    await action(core, logger);
  } catch (error) {
    output.appendLine(error instanceof Error ? error.message : String(error));
    vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

function writeIndexReport(output, logger, result) {
  output.clear();
  logger.info("indexing started");
  logger.info(`${result.filesIndexed} files indexed`);
  logger.info(`${result.written} artifacts written`);
  logger.info(`${result.skippedLarge} skipped large files count`);
  logger.info(`${result.ignored} ignored files count`);
  output.show();
}

function registerExportCommand(command, agent, output) {
  return vscode.commands.registerCommand(command, () => handleCommand(output, (core) => {
    const result = core.runMemoryExport(requireWorkspace(), agent);
    const results = result.results || [result];
    output.clear();
    output.appendLine("ForgeMind Memory Export");
    output.appendLine("");
    for (const item of results) output.appendLine(`${item.changed ? "Updated" : "Unchanged"} ${item.outputPath}`);
    output.show();
    vscode.window.showInformationMessage(`ForgeMind: exported memory to ${agent}`);
  }));
}

function activate(context) {
  const output = vscode.window.createOutputChannel("ForgeMind");

  context.subscriptions.push(
    output,
    vscode.commands.registerCommand("forgemind.initWorkspace", () => handleCommand(output, (core) => {
      const root = requireWorkspace();
      output.clear();
      const sync = core.runSync(root);
      const upgrade = core.runProjectUpgrade(root);
      const snapshot = core.runMemorySnapshot(root, { validationStatus: "ForgeMind init in progress." });
      const index = core.runContextIndex(root, { maxFileSizeKb: maxFileSizeKb(), sessionTracking: sessionTracking() });
      const graph = core.runGraphBuild(root, { sessionTracking: sessionTracking() });
      const pack = core.runContextPack(root, { maxSizeKb: contextPackMaxSizeKb(), sessionTracking: sessionTracking() });
      output.appendLine(`Created ${sync.created} missing file(s)`);
      output.appendLine(`${upgrade.action} .codex/AGENTS.md`);
      output.appendLine(`Updated ${path.relative(root, snapshot.file)}`);
      output.appendLine(`Indexed ${index.filesIndexed} file(s)`);
      output.appendLine(`Built graph with ${graph.entityCount} entities and ${graph.relationshipCount} relationships`);
      output.appendLine(`Wrote ${path.relative(root, pack.file)}`);
      output.show();
      vscode.window.showInformationMessage("ForgeMind: workspace initialized");
    })),
    vscode.commands.registerCommand("forgemind.syncWorkspace", () => handleCommand(output, (core) => {
      const result = core.runSync(requireWorkspace());
      vscode.window.showInformationMessage(`ForgeMind: created ${result.created} missing file(s)`);
    })),
    vscode.commands.registerCommand("forgemind.doctorWorkspace", () => handleCommand(output, (core) => {
      const result = core.runProjectDoctor(requireWorkspace());
      output.clear();
      output.appendLine("ForgeMind Doctor");
      output.appendLine("");
      for (const item of result.results) output.appendLine(item.line);
      output.show();
    })),
    vscode.commands.registerCommand("forgemind.upgradeAgents", () => handleCommand(output, (core) => {
      const result = core.runProjectUpgrade(requireWorkspace());
      vscode.window.showInformationMessage(`ForgeMind: ${result.action} .codex/AGENTS.md`);
    })),
    vscode.commands.registerCommand("forgemind.setupGlobal", () => handleCommand(output, (core) => {
      const result = core.runGlobalSetup();
      vscode.window.showInformationMessage(`ForgeMind: ${result.action} global AGENTS.md`);
    })),
    vscode.commands.registerCommand("forgemind.doctorGlobal", () => handleCommand(output, (core) => {
      const result = core.runGlobalDoctor();
      output.clear();
      output.appendLine("ForgeMind Global Doctor");
      output.appendLine("");
      for (const item of result.results) output.appendLine(item.line);
      output.show();
    })),
    vscode.commands.registerCommand("forgemind.indexWorkspace", () => handleCommand(output, (core, logger) => {
      output.clear();
      logger.info("indexing started");
      output.show();
      const result = core.runContextIndex(requireWorkspace(), { maxFileSizeKb: maxFileSizeKb(), sessionTracking: sessionTracking() });
      writeIndexReport(output, logger, result);
      vscode.window.showInformationMessage("ForgeMind: artifacts written");
    })),
    vscode.commands.registerCommand("forgemind.contextDoctor", () => handleCommand(output, (core) => {
      const result = core.runContextDoctor(requireWorkspace());
      output.clear();
      output.appendLine("ForgeMind Artifact Doctor");
      output.appendLine("");
      for (const item of result.results) output.appendLine(item.line);
      output.show();
    })),
    vscode.commands.registerCommand("forgemind.queryRelevant", () => handleCommand(output, async (core) => {
      const question = await vscode.window.showInputBox({ prompt: "What are you trying to change or understand?" });
      if (!question) return;
      const result = core.runQuery(requireWorkspace(), question, { sessionTracking: sessionTracking() });
      output.clear();
      output.appendLine("ForgeMind Query");
      output.appendLine("");
      output.appendLine(`Query: ${result.question}`);
      output.appendLine("");
      for (const match of result.matches) output.appendLine(`${match.score} ${match.path}`);
      output.show();
      vscode.window.showInformationMessage("ForgeMind: relevant context written");
    })),
    vscode.commands.registerCommand("forgemind.memorySnapshot", () => handleCommand(output, (core) => {
      const result = core.runMemorySnapshot(requireWorkspace(), { sessionTracking: sessionTracking() });
      vscode.window.showInformationMessage(`ForgeMind: updated ${path.relative(requireWorkspace(), result.file)}`);
    })),
    vscode.commands.registerCommand("forgemind.memoryDecision", () => handleCommand(output, async (core) => {
      const decision = await vscode.window.showInputBox({ prompt: "Decision" });
      if (!decision) return;
      const reason = await vscode.window.showInputBox({ prompt: "Reason (optional)" });
      const files = await vscode.window.showInputBox({ prompt: "Affected files (optional)" });
      const result = core.runMemoryAddDecision(requireWorkspace(), decision, { reason, files, sessionTracking: sessionTracking() });
      vscode.window.showInformationMessage(`ForgeMind: updated ${path.relative(requireWorkspace(), result.file)}`);
    })),
    vscode.commands.registerCommand("forgemind.memoryFailure", () => handleCommand(output, async (core) => {
      const failure = await vscode.window.showInputBox({ prompt: "Failure" });
      if (!failure) return;
      const cause = await vscode.window.showInputBox({ prompt: "Cause (optional)" });
      const fix = await vscode.window.showInputBox({ prompt: "Fix (optional)" });
      const files = await vscode.window.showInputBox({ prompt: "Affected files (optional)" });
      const result = core.runMemoryAddFailure(requireWorkspace(), { failure, cause, fix, files, sessionTracking: sessionTracking() });
      vscode.window.showInformationMessage(`ForgeMind: updated ${path.relative(requireWorkspace(), result.file)}`);
    })),
    vscode.commands.registerCommand("forgemind.contextPack", () => handleCommand(output, (core) => {
      const result = core.runContextPack(requireWorkspace(), { maxSizeKb: contextPackMaxSizeKb(), sessionTracking: sessionTracking() });
      output.clear();
      output.appendLine(`Wrote ${path.relative(requireWorkspace(), result.file)}`);
      output.appendLine(`Size ${result.sizeBytes} bytes`);
      output.show();
      vscode.window.showInformationMessage("ForgeMind: context pack generated");
    })),
    vscode.commands.registerCommand("forgemind.memoryCompress", () => handleCommand(output, async (core) => {
      const accepted = await vscode.window.showWarningMessage("ForgeMind: this uses local Ollama only and is optional.", "Continue");
      if (accepted !== "Continue") return;
      const model = await vscode.window.showInputBox({ prompt: "Ollama model", value: "qwen3:4b" });
      const result = await core.runMemoryCompress(requireWorkspace(), { model });
      vscode.window.showInformationMessage(`ForgeMind: wrote ${path.relative(requireWorkspace(), result.file)}`);
    })),
    vscode.commands.registerCommand("forgemind.memoryCompressDoctor", () => handleCommand(output, async (core) => {
      const result = await core.runMemoryCompressDoctor(requireWorkspace());
      output.clear();
      output.appendLine("ForgeMind Local LLM Doctor");
      output.appendLine("");
      for (const item of result.results) output.appendLine(item.line);
      output.show();
    })),
    vscode.commands.registerCommand("forgemind.memoryDoctor", () => handleCommand(output, (core) => {
      const result = core.runMemoryDoctor(requireWorkspace());
      output.clear();
      output.appendLine("ForgeMind Memory Doctor");
      output.appendLine("");
      for (const item of result.results) output.appendLine(item.line);
      output.show();
    })),
    registerExportCommand("forgemind.exportMemoryCodex", "codex", output),
    registerExportCommand("forgemind.exportMemoryCursor", "cursor", output),
    registerExportCommand("forgemind.exportMemoryClaude", "claude", output),
    registerExportCommand("forgemind.exportMemoryCopilot", "copilot", output),
    registerExportCommand("forgemind.exportMemoryAll", "all", output),
    vscode.commands.registerCommand("forgemind.exportMemoryDoctor", () => handleCommand(output, (core) => {
      const result = core.runMemoryExportDoctor(requireWorkspace());
      output.clear();
      output.appendLine("ForgeMind Memory Export Doctor");
      output.appendLine("");
      for (const item of result.results) output.appendLine(item.line);
      output.show();
    })),
    vscode.commands.registerCommand("forgemind.graphBuild", () => handleCommand(output, (core) => {
      const result = core.runGraphBuild(requireWorkspace());
      output.clear();
      output.appendLine(`Built graph with ${result.entityCount} entities and ${result.relationshipCount} relationships`);
      output.show();
      vscode.window.showInformationMessage("ForgeMind: knowledge graph built");
    })),
    vscode.commands.registerCommand("forgemind.graphDoctor", () => handleCommand(output, (core) => {
      const result = core.runGraphDoctor(requireWorkspace());
      output.clear();
      output.appendLine("ForgeMind Graph Doctor");
      output.appendLine("");
      for (const item of result.results) output.appendLine(item.line);
      output.show();
    })),
    vscode.commands.registerCommand("forgemind.graphClean", () => handleCommand(output, (core) => {
      const result = core.runGraphClean(requireWorkspace());
      vscode.window.showInformationMessage(`ForgeMind: ${result.removed ? "removed" : "no"} graph directory`);
    })),
    vscode.commands.registerCommand("forgemind.graphImpact", () => handleCommand(output, async (core) => {
      const target = await vscode.window.showInputBox({ prompt: "File path or symbol" });
      if (!target) return;
      const result = core.runGraphImpact(requireWorkspace(), target);
      output.clear();
      output.appendLine(result.report);
      output.show();
      vscode.window.showInformationMessage("ForgeMind: impact analysis written");
    })),
    vscode.commands.registerCommand("forgemind.graphQuery", () => handleCommand(output, async (core) => {
      const question = await vscode.window.showInputBox({ prompt: "Graph query" });
      if (!question) return;
      const result = core.runGraphQuery(requireWorkspace(), question);
      output.clear();
      output.appendLine(result.report);
      output.show();
      vscode.window.showInformationMessage("ForgeMind: graph query written");
    }))
  );

  loadCore().then((core) => {
    if (vscode.workspace.getConfiguration("forgemind").get("autoIndex", false)) {
      const root = workspaceRoot();
      if (root) {
        const count = core.countEligibleFiles(root, { maxFileSizeKb: maxFileSizeKb() });
        if (count < 1000) {
          vscode.window.showInformationMessage("Index ForgeMind now?", "Index").then((choice) => {
            if (choice === "Index") vscode.commands.executeCommand("forgemind.indexWorkspace");
          });
        } else {
          vscode.window.showInformationMessage("Use ForgeMind: Index Current Workspace when ready.");
        }
      }
    }

    if (vscode.workspace.getConfiguration("forgemind").get("watch", false)) {
      const root = workspaceRoot();
      if (root) {
        let timer;
        const watcher = vscode.workspace.createFileSystemWatcher("**/*");
        const schedule = (uri) => {
          if (core.isIgnoredWorkspacePath(root, uri.fsPath)) return;
          clearTimeout(timer);
          timer = setTimeout(() => vscode.commands.executeCommand("forgemind.indexWorkspace"), 1000);
        };
        watcher.onDidCreate(schedule);
        watcher.onDidChange(schedule);
        watcher.onDidDelete(schedule);
        context.subscriptions.push(watcher);
      }
    }
  });
}

function deactivate() {}

module.exports = { activate, deactivate };
