import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import terser from '@rollup/plugin-terser'

export default {
    input: 'src/firmware/esp-web-tools-flash-entry.mjs',
    output: {
        file: 'src/generated/esp-web-tools-flash.bundle.mjs',
        format: 'es',
        sourcemap: false,
        inlineDynamicImports: true
    },
    plugins: [
        nodeResolve({ browser: true, preferBuiltins: false }),
        commonjs(),
        json(),
        terser({ format: { comments: false } })
    ]
}
