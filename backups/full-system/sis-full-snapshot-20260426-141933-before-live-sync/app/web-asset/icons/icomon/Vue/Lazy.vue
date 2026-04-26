<template>
    <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <g>
            <circle cx="12" cy="2.5" r="2.5" />
            <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
        </g>
        <circle opacity="0.25" stroke-width="3" stroke="currentColor" fill="none" cx="12" cy="12" r="9.5" />
        <g>
            <circle cx="12" cy="2.5" r="2.5" />
            <animateTransform attributeName="transform" dur="1s" keyTimes="0; 0.5; 1" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12; 360 12 12" />
        </g>
    </svg>
</template>

<style scoped>
:root, .palette0 {color: currentColor;
    --color0: #fff;
    --color1: #000;
}
</style>