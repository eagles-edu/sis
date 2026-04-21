<template>
    <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <circle cx="12" cy="12" r="3">
            <animate attributeName="r" dur="1s" repeatCount="indefinite" values="3; 12" />
            <animate attributeName="opacity" dur="1s" repeatCount="indefinite" values="1; 0" />
        </circle>
        <circle cx="12" cy="12" r="3">
            <animate attributeName="r" dur="1s" repeatCount="indefinite" values="12; 3" />
            <animate attributeName="opacity" dur="1s" repeatCount="indefinite" values="0; 1" />
        </circle>
    </svg>
</template>

<style scoped>
:root, .palette0 {color: currentColor;
    --color0: #fff;
    --color1: #000;
}
</style>