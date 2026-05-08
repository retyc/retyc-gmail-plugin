<script setup lang="ts">
import {ref} from 'vue'
import {useI18n} from 'vue-i18n'

const props = defineProps<{
  files: File[]
}>()

const emit = defineEmits<{
  'add-files': [files: FileList | File[]]
  'remove-file': [index: number]
  'clear-files': []
}>()

const {t} = useI18n()

const isDragover = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function onDragenter(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  isDragover.value = true
}

function onDragover(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  isDragover.value = true
}

function onDragleave(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  isDragover.value = false
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  isDragover.value = false
  const dt = e.dataTransfer
  if (!dt) return
  const files: File[] = []
  if (dt.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== 'file') continue
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) continue
      const f = item.getAsFile();
      if (f) files.push(f)
    }
  } else {
    files.push(...Array.from(dt.files))
  }
  if (files.length) emit('add-files', files)
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) emit('add-files', input.files)
  input.value = ''
}

const totalSize = () => props.files.reduce((s, f) => s + f.size, 0)
</script>

<template>
  <div>
    <div
        class="dropzone"
        :class="{ 'is-dragover': isDragover }"
        tabindex="0"
        @click="fileInput?.click()"
        @keydown.enter.prevent="fileInput?.click()"
        @keydown.space.prevent="fileInput?.click()"
        @dragenter="onDragenter"
        @dragover="onDragover"
        @dragleave="onDragleave"
        @drop="onDrop"
    >
      <input ref="fileInput" type="file" multiple class="hidden" @change="onFileChange"/>

      <div v-if="!files.length" class="dropzone-empty">
        <UIcon name="i-lucide-upload" class="w-9 h-9 text-cornflower-blue-400"/>
        <p class="text-sm text-neutral-700">
          <strong>{{ t('dropzone.drop') }}</strong>
          <span class="block text-neutral-400">{{ t('dropzone.orClick') }}</span>
        </p>
      </div>

      <div v-else class="dropzone-files">
        <ul class="file-list">
          <li v-for="(file, i) in files" :key="i">
            <span class="file-name" :title="file.name">{{ file.name }}</span>
            <span class="file-size">{{ formatSize(file.size) }}</span>
            <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-x"
                :ui="{ base: 'shrink-0' }"
                @click.stop="emit('remove-file', i)"
            />
          </li>
        </ul>
      </div>
    </div>

    <div v-if="files.length" class="flex justify-between items-center text-xs text-neutral-500 mt-1 px-0.5">
      <span>{{ t('dropzone.fileCount', files.length, { named: { count: files.length, size: formatSize(totalSize()) } }) }}</span>
      <UButton color="neutral" variant="link" size="xs" @click="emit('clear-files')">{{ t('dropzone.removeAll') }}</UButton>
    </div>
  </div>
</template>

<style scoped>
.dropzone {
  position: relative;
  border: 2px dashed var(--color-neutral-300);
  border-radius: 8px;
  background: var(--color-neutral-50);
  padding: 16px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.dropzone:hover, .dropzone:focus-within {
  border-color: var(--color-primary-400);
  background: var(--color-primary-50);
  outline: none;
}

.dropzone.is-dragover {
  border-color: var(--color-primary-400);
  background: var(--color-primary-50);
}

.dropzone-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
  padding: 8px 0;
}

.dropzone-files {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 180px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--color-neutral-300) transparent;
}

.dropzone-files::-webkit-scrollbar {
  width: 4px;
}

.dropzone-files::-webkit-scrollbar-track {
  background: transparent;
}

.dropzone-files::-webkit-scrollbar-thumb {
  background: var(--color-neutral-300);
  border-radius: 2px;
}

.file-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-width: 0;
  background: #fff;
  border: 1px solid var(--color-neutral-200);
  border-radius: 6px;
  padding: 3px 5px;
}

.file-list .file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.file-list .file-size {
  color: var(--color-neutral-400);
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
