import {ref, computed, onMounted, onUnmounted} from 'vue'
import {getBridge} from '../../shared/bridge/client'
import type {HostDragOverlayPayload} from '../../shared/bridge/protocol'

export interface UseDropOverlayOptions {
  isActive: () => boolean
  onFiles: (files: File[]) => void
}

export function useDropOverlay(options: UseDropOverlayOptions) {
  const localCounter = ref(0)
  // Drag started over the host page (Gmail), forwarded by the content-script via the bridge.
  // OR'd with the local counter so the overlay shows for either source.
  const hostDrag = ref(false)
  const showOverlay = computed(() => localCounter.value > 0 || hostDrag.value)

  function onDocDragenter(e: DragEvent) {
    if (!options.isActive()) return
    e.preventDefault()
    localCounter.value++
  }

  function onDocDragleave() {
    if (localCounter.value === 0) return
    localCounter.value--
  }

  function onDocDragover(e: DragEvent) {
    if (showOverlay.value) e.preventDefault()
  }

  function onDocDrop(e: DragEvent) {
    e.preventDefault()
    localCounter.value = 0
  }

  function onOverlayDrop(e: DragEvent) {
    e.preventDefault()
    localCounter.value = 0
    hostDrag.value = false
    const dt = e.dataTransfer
    if (!dt) return
    const files: File[] = []
    if (dt.items) {
      for (const item of Array.from(dt.items)) {
        if (item.kind !== 'file') continue
        const entry = item.webkitGetAsEntry?.()
        if (entry?.isDirectory) continue
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    } else {
      files.push(...Array.from(dt.files))
    }
    if (files.length) options.onFiles(files)
  }

  let unsubHostDrag: (() => void) | null = null

  onMounted(() => {
    document.addEventListener('dragenter', onDocDragenter)
    document.addEventListener('dragleave', onDocDragleave)
    document.addEventListener('dragover', onDocDragover)
    document.addEventListener('drop', onDocDrop)
    unsubHostDrag = getBridge().on('hostDragOverlay', (payload) => {
      const v = (payload as HostDragOverlayPayload | undefined)?.visible
      hostDrag.value = !!v && options.isActive()
    })
  })

  onUnmounted(() => {
    document.removeEventListener('dragenter', onDocDragenter)
    document.removeEventListener('dragleave', onDocDragleave)
    document.removeEventListener('dragover', onDocDragover)
    document.removeEventListener('drop', onDocDrop)
    unsubHostDrag?.()
    unsubHostDrag = null
  })

  return {
    showOverlay,
    onOverlayDrop,
  }
}
