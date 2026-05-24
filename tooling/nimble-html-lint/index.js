// @ts-nocheck

const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const {analyzeSourceFile} = require('../nimble-html-template-analyzer/index.js')

function run(argv, io = {}) {
	const stdout = io.stdout || process.stdout
	const stderr = io.stderr || process.stderr
	const cwd = io.cwd || process.cwd()
	let projectPath = null

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		if (arg === '--project' || arg === '-p') projectPath = argv[index + 1]
	}

	if (!projectPath) {
		stderr.write('Usage: nimble-html-lint --project tsconfig.json\n')
		return 1
	}

	const resolvedProjectPath = path.resolve(cwd, projectPath)
	const configText = fs.readFileSync(resolvedProjectPath, 'utf8')
	const configResult = ts.parseConfigFileTextToJson(resolvedProjectPath, configText)
	if (configResult.error) {
		stderr.write(ts.formatDiagnostic(configResult.error, formatHost(cwd)))
		return 1
	}

	const parsedConfig = ts.parseJsonConfigFileContent(configResult.config, ts.sys, path.dirname(resolvedProjectPath))
	if (parsedConfig.errors.length) {
		stderr.write(ts.formatDiagnosticsWithColorAndContext(parsedConfig.errors, formatHost(cwd)))
		return 1
	}

	const program = ts.createProgram({
		rootNames: parsedConfig.fileNames,
		options: parsedConfig.options,
		projectReferences: parsedConfig.projectReferences,
	})

	const diagnostics = []
	for (const sourceFile of program.getSourceFiles()) {
		if (sourceFile.isDeclarationFile || sourceFile.fileName.includes('/node_modules/')) continue
		diagnostics.push(...analyzeSourceFile(ts, program, sourceFile))
	}

	for (const diagnostic of diagnostics) stdout.write(formatAnalyzerDiagnostic(diagnostic, cwd))
	if (diagnostics.length)
		stdout.write(`nimble-html-lint found ${diagnostics.length} issue${diagnostics.length === 1 ? '' : 's'}.\n`)
	return diagnostics.length ? 1 : 0
}

function formatHost(cwd) {
	return {
		getCanonicalFileName: fileName => fileName,
		getCurrentDirectory: () => cwd,
		getNewLine: () => '\n',
	}
}

function formatAnalyzerDiagnostic(diagnostic, cwd) {
	const {line, character} = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start || 0)
	return `${path.relative(cwd, diagnostic.file.fileName)}:${line + 1}:${character + 1} - error TS${diagnostic.code}: ${diagnostic.messageText}\n`
}

module.exports = {run}
