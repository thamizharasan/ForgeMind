import path from "node:path";
import * as vscode from "vscode";
import {
  countEligibleFiles,
  isIgnoredWorkspacePath,
  runContextDoctor,
  runContextIndex,
  runContextPack,
  runGlobalDoctor,
  runGlobalSetup,
  runGraphBuild,
  runGraphClean,
  runGraphDoctor,
  runGraphImpact,
  runGraphQuery,
  runMemoryAddDecision,
  runMemoryAddFailure,
  runMemoryCompress,
  runMemoryCompressDoctor,
  runMemoryDoctor,
  runMemoryExport,
  runMemoryExportDoctor,
  runMemorySnapshot,
  runNew,
  runProjectDoctor,
  runProjectUpgrade,
  runQuery,
  runSync
} from "./core.js";
import { createLogger } from "./core/logger.js";

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function requireWorkspace() {
  const root = workspaceRoot();
  if (!root) throw new Error("Open a workspace folder first.");
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

function writeIndexReport(output, logger, result) {
  output.clear();
  logger.info("indexing started");
  logger.info(`${result.filesIndexed} files indexed`);
  logger.info(`${result.written} artifacts written`);
  logger.info(`${result.skippedLarge} skipped large files count`);
  logger.info(`${result.ignored} ignored files count`);
  output.show();
}

function registerExportCommand(command, agent, logger, output) {
  return vscode.commands.registerCommand(command, () => handleCommand(logger, () => {
    const result = runMemoryExport(requireWorkspace(), agent);
    const results = result.results || [result];
    output.clear();
    output.appendLine("ForgeMind Memory Export");
    output.appendLine("");
    for (const item of results) output.appendLine(`${item.changed ? "Updated" : "Unchanged"} ${item.outputPath}`);
    output.show();
    vscode.window.showInformationMessage(`ForgeMind: exported memory to ${agent}`);
  }));
}

async function handleCommand(logger, action) {
  try {
    await action();
  } catch (error) {
    logger.error(error);
    vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

export function activate(context) {
  const output = vscode.window.createOutputChannel("ForgeMind");
  const logger = createLogger({ sink: { log: (message) => output.appendLine(message), error: (message) => output.appendLine(message) } });

  context.subscriptions.push(
    output,
    vscode.commands.registerCommand("forgemind.initWorkspace", () => handleCommand(logger, () => {
      const root = requireWorkspace();
      output.clear();
      const sync = runSync(root);
      const upgrade = runProjectUpgrade(root);
      const snapshot = runMemorySnapshot(root, { validationStatus: "ForgeMind init in progress." });
      const index = runContextIndex(root, { maxFileSizeKb: maxFileSizeKb(), sessionTracking: sessionTracking() });
      const graph = runGraphBuild(root, { sessionTracking: sessionTracking() });
      const pack = runContextPack(root, { maxSizeKb: contextPackMaxSizeKb(), sessionTracking: sessionTracking() });
      output.appendLine(`Created ${sync.created} missing file(s)`);
      output.appendLine(`${upgrade.action} .codex/AGENTS.md`);
      output.appendLine(`Updated ${path.relative(root, snapshot.file)}`);
      output.appendLine(`Indexed ${index.filesIndexed} file(s)`);
      output.appendLine(`Built graph with ${graph.entityCount} entities and ${graph.relationshipCount} relationships`);
      output.appendLine(`Wrote ${path.relative(root, pack.file)}`);
      output.show();
      vscode.window.showInformationMessage("ForgeMind: workspace initialized");
    })),
    vscode.commands.registerCommand("forgemind.syncWorkspace", () => handleCommand(logger, () => {
      const result = runSync(requireWorkspace());
      vscode.window.showInformationMessage(`ForgeMind: created ${result.created} missing file(s)`);
    })),
    vscode.commands.registerCommand("forgemind.doctorWorkspace", () => handleCommand(logger, () => {
      const result = runProjectDoctor(requireWorkspace());
      output.clear();
      output.appendLine("ForgeMind Doctor");
      output.appendLine("");
      for (const item of result.results) output.appendLine(item.line);
      output.show();
    })),
    vscode.commands.registerCommand("forgemind.upgradeAgents", () => handleCommand(logger, () => {
      const result = runProjectUpgrade(requireWorkspace());
      vscode.window.showInformationMessage(`ForgeMind: ${result.action} .codex/AGENTS.md`);
    })),
    vscode.commands.registerCommand("forgemind.setupGlobal", () => handleCommand(logger, () => {
      const result = runGlobalSetup();
      vscode.window.showInformationMessage(`ForgeMind: ${result.action} global AGENTS.md`);
    })),
    vscode.commands.registerCommand("forgemind.doctorGlobal", () => handleCommand(logger, () => {
      const result = runGlobalDoctor();
      output.clear();
      output.appendLine("ForgeMind Global Doctor");
      output.appendLine("");
      for (const item of result.results) output.appendLine(item.line);
      output.show();
    })),
    vscode.commands.registerCommand("forgemind.indexWorkspace", () => handleCommand(logger, () => {
      output.clear();
      logger.info("indexing started");
      output.show();
      const result = runContextIndex(requireWorkspace(), { maxFileSizeKb: maxFileSizeKb(), sessionTracking: sessionTracking() });
      writeIndexReport(output, logger, result);
      vscode.window.showInformationMessage("ForgeMind: artifacts written");
    })),
    vscode.commands.registerCommand("forgemind.contextDoctor", () => handleCommand(logger, () => {
      const result = runContextDoctor(requireWorkspace());
      output.clear();
      output.appendLine("ForgeMind Artifact Doctor");
      output.appendLine("");
      for (const item of result.results) output.appendLine(item.line);
      output.show();
    })),
    vscode.commands.registerCommand("forgemind.queryRelevant", () => handleCommand(logger, async () => {
      const question = await vscode.window.showInputBox({ prompt: "What are you trying to change or understand?" });
      if (!question) return;
      const result = runQuery(requireWorkspace(), question, { sessionTracking: sessionTracking() });
      output.clear();
      output.appendLine("ForgeMind Query");
      output.appendLine("");
      output.appendLine(`Query: ${result.question}`);
      output.appendLine("");
      for (const match of result.matches) output.appendLine(`${match.score} ${match.path}`);
      output.show();
      vscode.window.showInformationMessage("ForgeMind: relevant context written");
    })),
    vscode.commands.registerCommand("forgemind.memorySnapshot", () => handleCommand(logger, () => {
      const root = requireWorkspace();
      const result = runMemorySnapshot(root, { sessionTracking: sessionTracking() });
      vscode.window.showInformationMessage(`ForgeMind: updated ${path.relative(root, result.file)}`);
    })),
    vscode.commands.registerCommand("forgemind.memoryDecision", () => handleCommand(logger, async () => {
      const root = requireWorkspace();
      const decision = await vscode.window.showInputBox({ prompt: "Decision" });
      if (!decision) return;
      const reason = await vscode.window.showInputBox({ prompt: "Reason (optional)" });
      const files = await vscode.window.showInputBox({ prompt: "Affected files (optional)" });
      const result = runMemoryAddDecision(root, decision, { reason, files, sessionTracking: sessionTracking() });
      vscode.window.showInformationMessage(`ForgeMind: updated ${path.relative(root, result.file)}`);
    })),
    vscode.commands.registerCommand("forgemind.memoryFailure", () => handleCommand(logger, async () => {
      const root = requireWorkspace();
      const failure = await vscode.window.showInputBox({ prompt: "Failure" });
      if (!failure) return;
      const cause = await vscode.window.showInputBox({ prompt: "Cause (optional)" });
      const fix = await vscode.window.showInputBox({ prompt: "Fix (optional)" });
      const files = await vscode.window.showInputBox({ prompt: "Affected files (optional)" });
      const result = runMemoryAddFailure(root, { failure, cause, fix, files, sessionTracking: sessionTracking() });
      vscode.window.showInformationMessage(`ForgeMind: updated ${path.relative(root, result.file)}`);
    })),
    vscode.commands.registerCommand("forgemind.contextPack", () => handleCommand(logger, () => {
      const root = requireWorkspace();
      const result = runContextPack(root, { maxSizeKb: contextPackMaxSizeKb(), sessionTracking: sessionTracking() });
      output.clear();
      output.appendLine(`Wrote ${path.relative(root, result.file)}`);
      output.appendLine(`Size ${result.sizeBytes} bytes`);
      output.show();
      vscode.window.showInformationMessage("ForgeMind: context pack generated");
    })),
    vscode.commands.registerCommand("forgemind.memoryCompress", () => handleCommand(logger, async () => {
      const root = requireWorkspace();
      const accepted = await vscode.window.showWarningMessage("ForgeMind: this uses local Ollama only and is optional.", "Continue");
      if (accepted !== "Continue") return;
      const model = await vscode.window.showInputBox({ prompt: "Ollama model", value: "qwen3:4b" });
      const result = await runMemoryCompress(root, { model });
      vscode.window.showInformationMessage(`ForgeMind: wrote ${path.relative(root, result.file)}`);
    })),
    vscode.commands.registerCommand("forgemind.memoryCompressDoctor", () => handleCommand(logger, async () => {
      const result = await runMemoryCompressDoctor(requireWorkspace());
      output.clear();
      output.appendLine("ForgeMind Local LLM Doctor");
      output.appendLine("");
      for (const item of result.results) output.appendLine(item.line);
      output.show();
    })),
    vscode.commands.registerCommand("forgemind.memoryDoctor", () => handleCommand(logger, () => {
      const result = runMemoryDoctor(requireWorkspace());
      output.clear();
      output.appendLine("ForgeMind Memory Doctor");
      output.appendLine("");
      for (const item of result.results) output.appendLine(item.line);
      output.show();
    })),
    registerExportCommand("forgemind.exportMemoryCodex", "codex", logger, output),
    registerExportCommand("forgemind.exportMemoryCursor", "cursor", logger, output),
    registerExportCommand("forgemind.exportMemoryClaude", "claude", logger, output),
    registerExportCommand("forgemind.exportMemoryCopilot", "copilot", logger, output),
    registerExportCommand("forgemind.exportMemoryAll", "all", logger, output),
    vscode.commands.registerCommand("forgemind.exportMemoryDoctor", () => handleCommand(logger, () => {
      const result = runMemoryExportDoctor(requireWorkspace());
      output.clear();
      output.appendLine("ForgeMind Memory Export Doctor");
      output.appendLine("");
      for (const item of result.results) output.appendLine(item.line);
      output.show();
    })),
    vscode.commands.registerCommand("forgemind.graphBuild", () => handleCommand(logger, () => {
      const result = runGraphBuild(requireWorkspace());
      output.clear();
      output.appendLine(`Built graph with ${result.entityCount} entities and ${result.relationshipCount} relationships`);
      output.show();
      vscode.window.showInformationMessage("ForgeMind: knowledge graph built");
    })),
    vscode.commands.registerCommand("forgemind.graphDoctor", () => handleCommand(logger, () => {
      const result = runGraphDoctor(requireWorkspace());
      output.clear();
      output.appendLine("ForgeMind Graph Doctor");
      output.appendLine("");
      for (const item of result.results) output.appendLine(item.line);
      output.show();
    })),
    vscode.commands.registerCommand("forgemind.graphClean", () => handleCommand(logger, () => {
      const result = runGraphClean(requireWorkspace());
      vscode.window.showInformationMessage(`ForgeMind: ${result.removed ? "removed" : "no"} graph directory`);
    })),
    vscode.commands.registerCommand("forgemind.graphImpact", () => handleCommand(logger, async () => {
      const target = await vscode.window.showInputBox({ prompt: "File path or symbol" });
      if (!target) return;
      const result = runGraphImpact(requireWorkspace(), target);
      output.clear();
      output.appendLine(result.report);
      output.show();
      vscode.window.showInformationMessage("ForgeMind: impact analysis written");
    })),
    vscode.commands.registerCommand("forgemind.graphQuery", () => handleCommand(logger, async () => {
      const question = await vscode.window.showInputBox({ prompt: "Graph query" });
      if (!question) return;
      const result = runGraphQuery(requireWorkspace(), question);
      output.clear();
      output.appendLine(result.report);
      output.show();
      vscode.window.showInformationMessage("ForgeMind: graph query written");
    }))
  );

  if (vscode.workspace.getConfiguration("forgemind").get("autoIndex", false)) {
    const root = workspaceRoot();
    if (root) {
      const count = countEligibleFiles(root, { maxFileSizeKb: maxFileSizeKb() });
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
        if (isIgnoredWorkspacePath(root, uri.fsPath)) return;
        clearTimeout(timer);
        timer = setTimeout(() => vscode.commands.executeCommand("forgemind.indexWorkspace"), 1000);
      };
      watcher.onDidCreate(schedule);
      watcher.onDidChange(schedule);
      watcher.onDidDelete(schedule);
      context.subscriptions.push(watcher);
    }
  }
}

export function deactivate() {}
