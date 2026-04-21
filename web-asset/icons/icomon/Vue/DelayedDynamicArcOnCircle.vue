<template>
    <svg viewBox="0 0 24 24" stroke-width="3" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <circle opacity="0.3" cx="12" cy="12" r="10.5" />
        <circle stroke-linecap="round" cx="12" cy="12" r="10.5" stroke-dasharray="66 66" stroke-dashoffset="20">
            <animate attributeName="stroke-dashoffset" dur="5s" repeatCount="indefinite" values="10; 60; 60; 60; 60; 10" />
            <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="-90 12 12;270 12 12" />
        </circle>
    </svg>
</template>

<style scoped>
:root, .palette0 {color: currentColor;
    --color0: #fff;
    --color1: #000;
}
</style>