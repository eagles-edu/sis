<template>
    <svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <circle cx="12" cy="12" r="11" />
        <g>
            <circle cx="12" cy="4" r="3">
                <animate attributeName="r" dur="8s" repeatCount="indefinite" values="3; 8; 3" />
                <animate attributeName="cy" dur="8s" repeatCount="indefinite" values="4; 9; 4" />
                <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
            </circle>
        </g>
    </svg>
</template>

<style scoped>
:root, .palette0 {color: currentColor;
    --color0: #fff;
    --color1: #000;
}
</style>