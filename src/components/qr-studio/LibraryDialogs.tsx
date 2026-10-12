import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { MAX_FOLDER_NAME, MAX_TAG_NAME } from '../../services/qrStudioStore'
import type { QrFolder, QrTag } from '../../types/qrStudio'
import { Button, Dialog, Select } from '../ui'
import { TextField, labelClass } from './formControls'
import { NO_FOLDER, plural } from './libraryUtils'
import type { ActionResult, UseQrStore } from './useQrStore'

export type FolderDialogState =
  | { mode: 'create' }
  | { mode: 'rename'; folder: QrFolder }

/** Create or rename a folder. Rule violations from the reducer show inline in the dialog. */
export function FolderDialog({
  state,
  store,
  onClose,
  onDone,
}: {
  state: FolderDialogState
  store: UseQrStore
  onClose: () => void
  onDone: (folder: QrFolder, mode: 'create' | 'rename') => void
}) {
  const formId = useId()
  const [name, setName] = useState(
    state.mode === 'rename' ? state.folder.name : '',
  )
  const [error, setError] = useState<string | undefined>()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result: ActionResult<QrFolder> =
      state.mode === 'rename'
        ? store.renameFolder(state.folder.id, name)
        : store.createFolder(name)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onDone(result.value, state.mode)
  }
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={state.mode === 'rename' ? 'Rename folder' : 'New folder'}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form={formId}>
            {state.mode === 'rename' ? 'Save name' : 'Create folder'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit}>
        <TextField
          label="Folder name"
          value={name}
          onChange={(next) => {
            setName(next)
            setError(undefined)
          }}
          error={error}
          maxLength={MAX_FOLDER_NAME + 10}
          autoFocus
        />
      </form>
    </Dialog>
  )
}

/** Pick a destination folder for one or more records. */
export function MoveDialog({
  count,
  folders,
  onClose,
  onMove,
}: {
  count: number
  folders: QrFolder[]
  onClose: () => void
  onMove: (folderId: string | null) => void
}) {
  const [target, setTarget] = useState(NO_FOLDER)
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Move ${plural(count, 'code')}`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => onMove(target === NO_FOLDER ? null : target)}
          >
            Move
          </Button>
        </>
      }
    >
      <p className={labelClass}>Destination folder</p>
      <Select
        aria-label="Destination folder"
        value={target}
        onChange={setTarget}
        options={[
          { value: NO_FOLDER, label: 'Uncategorized' },
          ...folders.map((folder) => ({
            value: folder.id,
            label: folder.name,
          })),
        ]}
        className="w-full"
      />
    </Dialog>
  )
}

/** Rename or remove tags. Removal is confirmed by the caller. */
export function ManageTagsDialog({
  store,
  onClose,
  onRemove,
}: {
  store: UseQrStore
  onClose: () => void
  onRemove: (tag: QrTag) => void
}) {
  const [newName, setNewName] = useState('')
  const [newError, setNewError] = useState<string | undefined>()
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null,
  )
  const [editError, setEditError] = useState<string | undefined>()
  const usage = (id: string) =>
    store.state.records.filter((record) => record.tags.includes(id)).length

  const addNew = (event: FormEvent) => {
    event.preventDefault()
    const result = store.addTag(newName)
    if (!result.ok) {
      setNewError(result.error)
      return
    }
    setNewName('')
  }
  const saveEdit = (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    const result = store.renameTag(editing.id, editing.name)
    if (!result.ok) {
      setEditError(result.error)
      return
    }
    setEditing(null)
    setEditError(undefined)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title="Manage tags"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <form onSubmit={addNew} className="mb-4 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <TextField
            label="New tag"
            value={newName}
            onChange={(next) => {
              setNewName(next)
              setNewError(undefined)
            }}
            error={newError}
            maxLength={MAX_TAG_NAME + 10}
          />
        </div>
        <Button size="sm" type="submit" className="mt-6">
          Add tag
        </Button>
      </form>
      {store.state.tags.length === 0 ? (
        <p className="text-[11px] text-slate-500">
          No tags yet. Add one above or from a code&apos;s details.
        </p>
      ) : (
        <ul className="space-y-2">
          {store.state.tags.map((tag) => (
            <li
              key={tag.id}
              className="rounded-lg border border-[#2a3749] bg-[#0d1725] p-2"
            >
              {editing?.id === tag.id ? (
                <form onSubmit={saveEdit} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <TextField
                      label="Tag name"
                      value={editing.name}
                      onChange={(next) => {
                        setEditing({ id: tag.id, name: next })
                        setEditError(undefined)
                      }}
                      error={editError}
                      maxLength={MAX_TAG_NAME + 10}
                      autoFocus
                    />
                  </div>
                  <Button size="sm" type="submit" className="mt-6">
                    Save name
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-6"
                    onClick={() => {
                      setEditing(null)
                      setEditError(undefined)
                    }}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-white">
                    {tag.name}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {plural(usage(tag.id), 'code')}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Rename tag ${tag.name}`}
                    onClick={() => setEditing({ id: tag.id, name: tag.name })}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    aria-label={`Remove tag ${tag.name}`}
                    onClick={() => onRemove(tag)}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
