import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const testsDirectory = new URL('../tests/', import.meta.url)
const testFiles = (await readdir(testsDirectory))
    .filter((fileName) => fileName.endsWith('.test.mjs'))
    .sort()
    .map((fileName) => fileURLToPath(new URL(fileName, testsDirectory)))

if (testFiles.length === 0) {
    console.error('No test files found in tests/*.test.mjs')
    process.exit(1)
}

const testProcess = spawn(process.execPath, ['--test', ...testFiles], {
    stdio: 'inherit'
})

testProcess.on('error', (error) => {
    console.error(error)
    process.exit(1)
})

testProcess.on('close', (exitCode) => {
    process.exit(exitCode ?? 1)
})
