<template>
    <svg viewBox="0 0 24 24" stroke-width="3" stroke="currentColor" stroke-linecap="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <g>
            <circle cx="12" cy="12" r="10.5" stroke-dasharray="10 66">
                <animate attributeName="stroke-dasharray" dur="3s" repeatCount="indefinite" values="10 66; 46 66; 10 66" />
                <animate attributeName="opacity" dur="3s" repeatCount="indefinite" values="0.4; 1; 0.4" />
            </circle>
            <g transform="rotate(142 12 12)">
                <circle transform="matrix(-1, 0, 0, 1, 24, 0)" cx="12" cy="12" r="10.5" stroke-dasharray="42 66">
                    <animate attributeName="stroke-dasharray" dur="3s" repeatCount="indefinite" values="42 66; 6 66; 42 66" />
                    <animate attributeName="opacity" dur="3s" repeatCount="indefinite" values="1; 0.4; 1" />
                </circle>
            </g>
            <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
        </g>
    </svg>
</template>

<style scoped>
:root, .palette0 {color: currentColor;
    --color0: #fff;
    --color1: #000;
}
</style>