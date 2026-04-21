<template>
    <svg viewBox="0 0 24 24" stroke-width="3" stroke="currentColor" stroke-linecap="round" fill="none" width="32" height="32" stroke-dasharray="66 66" stroke-dashoffset="50" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <circle opacity="0.3" cx="12" cy="12" r="10.5" stroke-dashoffset="0" />
        <circle cx="12" cy="12" r="10.5">
            <animate attributeName="stroke-dashoffset" dur="2s" keyTimes="0; 0.3; 0.8; 1" repeatCount="indefinite" values="50; 60; 66; 50" />
            <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="-90 12 12;270 12 12" />
        </circle>
        <circle transform="rotate(180 12 12)" cx="12" cy="12" r="10.5">
            <animate attributeName="stroke-dashoffset" dur="2s" keyTimes="0; 0.3; 0.8; 1" repeatCount="indefinite" values="50; 60; 66; 50" />
            <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="90 12 12;450 12 12" />
        </circle>
    </svg>
</template>

<style scoped>
:root, .palette0 {color: currentColor;
    --color0: #fff;
    --color1: #000;
}
</style>