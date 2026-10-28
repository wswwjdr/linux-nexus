import type { OperationExecutionStrategy } from '@shared/types'

const moveFlags: Record<OperationExecutionStrategy, string> = {
  force: '-fT',
  skip: '-nT',
  update: '-uT',
}

export function uploadMoveFlag(strategy: OperationExecutionStrategy): string {
  return moveFlags[strategy]
}
