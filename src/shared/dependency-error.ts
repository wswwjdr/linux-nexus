import { LocalizedError, msg } from './i18n/messages'
import type { DependencyIssue } from './types/dependencies'

/** A preflight failure that can be resolved before retrying the operation. */
export class DependencyRequiredError extends LocalizedError {
  constructor(readonly issue: DependencyIssue) {
    super(msg('errors.dependencyStillMissing'))
  }
}
