/**
 * Formats unknown errors for user-visible status messages.
 * @param {unknown} error
 * @returns {string}
 */
export function errorMessage(error) {
    return error instanceof Error
        ? error.message
        : String(error || 'Unknown error')
}
