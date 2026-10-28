import { useRef, useState, type DragEvent, type MutableRefObject } from 'react'
import type { DroppedUploadEntry, RemoteEntry } from '@shared/types'

const remoteMoveMime = 'application/x-linux-nexus-remote-files'

interface UseFileDragAndDropOptions {
  sortedEntries: RemoteEntry[]
  selectedPathsRef: MutableRefObject<string[]>
  operationActive: boolean
  onDropUpload: (entries: DroppedUploadEntry[]) => void
  onDropMove: (sourcePaths: string[], targetDirectory: string) => void
  onDropError: (error: unknown) => void
  onDragStart: () => void
}

function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes('Files')
}

function hasRemoteMove(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(remoteMoveMime)
}

function readRemoteMovePaths(dataTransfer: DataTransfer): string[] {
  try {
    const paths: unknown = JSON.parse(dataTransfer.getData(remoteMoveMime))
    return Array.isArray(paths) && paths.every((path) => typeof path === 'string') ? paths : []
  } catch {
    return []
  }
}

function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

function readDirectoryBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

async function readDirectoryEntries(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = entry.createReader()
  const children: FileSystemEntry[] = []
  while (true) {
    const batch = await readDirectoryBatch(reader)
    if (batch.length === 0) return children
    children.push(...batch)
  }
}

function droppedFile(file: File, relativePath: string): DroppedUploadEntry {
  const localPath = window.remoteFiles.getPathForFile(file)
  if (!localPath) throw new Error('无法读取拖入文件的本机路径：' + file.name)
  return { relativePath, type: 'file', localPath }
}

async function readDroppedEntry(entry: FileSystemEntry, parentPath: string): Promise<DroppedUploadEntry[]> {
  const relativePath = parentPath ? parentPath + '/' + entry.name : entry.name
  if (entry.isFile) return [droppedFile(await readFileEntry(entry as FileSystemFileEntry), relativePath)]
  if (!entry.isDirectory) throw new Error('拖入内容包含暂不支持的文件类型')

  const children = await readDirectoryEntries(entry as FileSystemDirectoryEntry)
  const descendants = await Promise.all(children.map((child) => readDroppedEntry(child, relativePath)))
  return [{ relativePath, type: 'directory' }, ...descendants.flat()]
}

async function collectDroppedEntries(dataTransfer: DataTransfer): Promise<DroppedUploadEntry[]> {
  const roots: FileSystemEntry[] = []
  const standaloneFiles: File[] = []
  for (const item of Array.from(dataTransfer.items).filter((candidate) => candidate.kind === 'file')) {
    const entry = item.webkitGetAsEntry()
    if (entry) roots.push(entry)
    else {
      const file = item.getAsFile()
      if (file) standaloneFiles.push(file)
    }
  }

  if (roots.length === 0 && standaloneFiles.length === 0) standaloneFiles.push(...Array.from(dataTransfer.files))
  const rootEntries = await Promise.all(roots.map((entry) => readDroppedEntry(entry, '')))
  const files = standaloneFiles.map((file) => droppedFile(file, file.name))
  return [...rootEntries.flat(), ...files]
}

export function useFileDragAndDrop({
  sortedEntries,
  selectedPathsRef,
  operationActive,
  onDropUpload,
  onDropMove,
  onDropError,
  onDragStart,
}: UseFileDragAndDropOptions) {
  const dragDepthRef = useRef(0)
  const [dropActive, setDropActive] = useState(false)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)

  const handleContentDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!hasDraggedFiles(event.dataTransfer)) return
    dragDepthRef.current += 1
    setDropActive(true)
  }

  const handleContentDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (hasRemoteMove(event.dataTransfer)) {
      const targetElement = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-entry-path]') : null
      const target = targetElement?.dataset.entryPath
        ? sortedEntries.find((entry) => entry.path === targetElement.dataset.entryPath)
        : undefined
      const sourcePaths = readRemoteMovePaths(event.dataTransfer)
      event.dataTransfer.dropEffect = !operationActive && target?.type === 'directory' && !sourcePaths.includes(target.path) ? 'move' : 'none'
      return
    }
    event.dataTransfer.dropEffect = hasDraggedFiles(event.dataTransfer) ? 'copy' : 'none'
  }

  const handleContentDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (dragDepthRef.current === 0) return
    dragDepthRef.current -= 1
    if (dragDepthRef.current === 0) setDropActive(false)
  }

  const handleContentDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepthRef.current = 0
    setDropActive(false)
    if (hasRemoteMove(event.dataTransfer) || !hasDraggedFiles(event.dataTransfer)) return
    try {
      onDropUpload(await collectDroppedEntries(event.dataTransfer))
    } catch (error) {
      onDropError(error)
    }
  }

  const handleEntryDragStart = (entry: RemoteEntry, event: DragEvent<HTMLElement>) => {
    if (operationActive || (entry.type !== 'file' && entry.type !== 'directory')) {
      event.preventDefault()
      return
    }
    const selected = new Set(selectedPathsRef.current)
    const sources = selected.has(entry.path)
      ? sortedEntries.filter((candidate) => selected.has(candidate.path)
        && (candidate.type === 'file' || candidate.type === 'directory'))
      : [entry]
    const paths = sources
      .filter((candidate) => candidate.type === 'file' || candidate.type === 'directory')
      .map((candidate) => candidate.path)
    if (paths.length === 0) {
      event.preventDefault()
      return
    }
    onDragStart()
    event.dataTransfer.setData(remoteMoveMime, JSON.stringify(paths))
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleEntryDragOver = (entry: RemoteEntry, event: DragEvent<HTMLElement>) => {
    if (!hasRemoteMove(event.dataTransfer)) return
    event.preventDefault()
    const paths = readRemoteMovePaths(event.dataTransfer)
    const validTarget = !operationActive && entry.type === 'directory' && paths.length > 0 && !paths.includes(entry.path)
    event.dataTransfer.dropEffect = validTarget ? 'move' : 'none'
    setDropTargetPath(validTarget ? entry.path : null)
  }

  const handleEntryDragLeave = (entry: RemoteEntry, event: DragEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    setDropTargetPath((current) => current === entry.path ? null : current)
  }

  const handleEntryDrop = (entry: RemoteEntry, event: DragEvent<HTMLElement>) => {
    if (!hasRemoteMove(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    setDropTargetPath(null)
    const paths = readRemoteMovePaths(event.dataTransfer)
    if (operationActive || entry.type !== 'directory' || paths.length === 0) return
    if (paths.includes(entry.path)) {
      onDropError(new Error('不能将文件夹移动到自身'))
      return
    }
    onDropMove(paths, entry.path)
  }

  return {
    dropActive,
    dropTargetPath,
    handleContentDragEnter,
    handleContentDragOver,
    handleContentDragLeave,
    handleContentDrop,
    handleEntryDragStart,
    handleEntryDragOver,
    handleEntryDragLeave,
    handleEntryDrop,
  }
}
