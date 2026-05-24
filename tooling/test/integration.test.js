// @ts-nocheck

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {createRequire} from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const pluginInit = require('../nimble-html-typescript-plugin/index.js')
const {run} = require('../nimble-html-lint/index.js')
const fixtureRoot = path.resolve('tooling/test-fixtures/fixture-project')
const tsconfigPath = path.join(fixtureRoot, 'tsconfig.json')

function createPluginLanguageService() {
	const configText = fs.readFileSync(tsconfigPath, 'utf8')
	const configResult = ts.parseConfigFileTextToJson(tsconfigPath, configText)
	const parsedConfig = ts.parseJsonConfigFileContent(configResult.config, ts.sys, fixtureRoot)
	const versions = new Map(parsedConfig.fileNames.map(fileName => [fileName, '0']))
	const host = {
		getCompilationSettings: () => parsedConfig.options,
		getCurrentDirectory: () => fixtureRoot,
		getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
		getScriptFileNames: () => parsedConfig.fileNames,
		getScriptVersion: fileName => versions.get(fileName) || '0',
		getScriptSnapshot: fileName =>
			fs.existsSync(fileName) ? ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8')) : undefined,
		fileExists: ts.sys.fileExists,
		readFile: ts.sys.readFile,
		readDirectory: ts.sys.readDirectory,
		directoryExists: ts.sys.directoryExists,
		getDirectories: ts.sys.getDirectories,
	}
	const baseLanguageService = ts.createLanguageService(host)
	const plugin = pluginInit({typescript: ts})
	const languageService = plugin.create({
		languageService: baseLanguageService,
		languageServiceHost: host,
		project: {
			getCurrentDirectory: () => fixtureRoot,
			getCompilerOptions: () => parsedConfig.options,
			projectService: {
				logger: {
					info() {},
					msg() {},
					hasLevel() {
						return false
					},
				},
			},
		},
		config: {},
	})
	return {languageService, parsedConfig}
}

function getPosition(filePath, snippet, offset = 0) {
	const text = fs.readFileSync(filePath, 'utf8')
	const index = text.indexOf(snippet)
	assert.notStrictEqual(index, -1, `Snippet not found: ${snippet}`)
	return index + offset
}

test('plugin diagnostics match the shared analyzer for TS files', () => {
	const {languageService} = createPluginLanguageService()
	const filePath = path.join(fixtureRoot, 'src/diagnostics.ts')
	const diagnostics = languageService.getSemanticDiagnostics(filePath).filter(diagnostic => diagnostic.code >= 91000)
	assert.deepEqual(
		diagnostics.map(diagnostic => diagnostic.code),
		[91001, 91002, 91003, 91005, 91004, 91006, 91007, 91004, 91007, 91004],
	)
	assert(
		diagnostics.some(
			diagnostic =>
				diagnostic.code === 91004 &&
				String(diagnostic.messageText).includes('@change expects a function, string, false, null, or undefined.'),
		),
	)
})

test('plugin diagnostics work for JS files with JSDoc typing', () => {
	const {languageService} = createPluginLanguageService()
	const filePath = path.join(fixtureRoot, 'src/diagnostics-js.js')
	const diagnostics = languageService.getSemanticDiagnostics(filePath).filter(diagnostic => diagnostic.code >= 91000)
	assert.deepEqual(
		diagnostics.map(diagnostic => diagnostic.code),
		[91001, 91002],
	)
})

test('plugin completions suggest nimble-html bindings in template text', () => {
	const {languageService} = createPluginLanguageService()
	const filePath = path.join(fixtureRoot, 'src/completions.ts')
	const attrCompletions = languageService.getCompletionsAtPosition(filePath, getPosition(filePath, '<input />', 7), {})
	const propCompletions = languageService.getCompletionsAtPosition(
		filePath,
		getPosition(filePath, '<input . />', 8),
		{},
	)
	const eventCompletions = languageService.getCompletionsAtPosition(
		filePath,
		getPosition(filePath, '<button @></button>', 9),
		{},
	)
	const boolCompletions = languageService.getCompletionsAtPosition(
		filePath,
		getPosition(filePath, '<input ? />', 8),
		{},
	)
	const spreadCompletions = languageService.getCompletionsAtPosition(filePath, getPosition(filePath, '...${{}}', 6), {})

	assert(attrCompletions?.entries.some(entry => entry.name === 'value'))
	assert(propCompletions?.entries.some(entry => entry.name === '.value'))
	assert(eventCompletions?.entries.some(entry => entry.name === '@click'))
	assert(boolCompletions?.entries.some(entry => entry.name === '?hidden'))
	assert(spreadCompletions?.entries.some(entry => entry.name === 'title' && entry.insertText === 'title'))
	assert(spreadCompletions?.entries.some(entry => entry.name === '?hidden' && entry.insertText === "'?hidden'"))
	assert(spreadCompletions?.entries.some(entry => entry.name === '.value' && entry.insertText === "'.value'"))
	assert(spreadCompletions?.entries.some(entry => entry.name === '@click' && entry.insertText === "'@click'"))
})

test('cli reports the same TS diagnostics as the plugin', () => {
	const stdout = []
	const stderr = []
	const exitCode = run(['--project', tsconfigPath], {
		cwd: fixtureRoot,
		stdout: {
			write(chunk) {
				stdout.push(String(chunk))
			},
		},
		stderr: {
			write(chunk) {
				stderr.push(String(chunk))
			},
		},
	})
	assert.equal(exitCode, 1)
	assert.equal(stderr.length, 0)
	const output = stdout.join('')
	assert(output.includes('src/diagnostics.ts'))
	assert(output.includes('src/diagnostics-js.js'))
	assert(output.includes('TS91004'))
	assert(output.includes('TS91007'))
	assert(output.includes('nimble-html-lint found 12 issues.'))
})
