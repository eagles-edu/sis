<template>
    <svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <g>
            <animateTransform attributeName="transform" dur="3s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
            <ellipse cx="12" cy="12" rx="11" ry="4">
                <animate attributeName="ry" dur="2s" repeatCount="indefinite" values="4; 0.1; 4; 4" />
            </ellipse>
            <ellipse transform="rotate(-90 12 12)" cx="12" cy="12" rx="11" ry="4">
                <animate attributeName="ry" dur="2s" repeatCount="indefinite" values="4; 0.1; 0.1; 4" />
            </ellipse>
        </g>
    </svg>
</template>

<style scoped>
:root, .palette0 {color: currentColor;
    --color0: #fff;
    --color1: #000;
}
</style>