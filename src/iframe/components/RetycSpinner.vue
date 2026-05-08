<template>
  <img src="/assets/icon-blue.svg" alt="" class="spinner"/>
</template>

<style scoped>
.spinner {
  animation: spin 1.2s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
