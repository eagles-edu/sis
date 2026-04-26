<template>
    <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <g>
            <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="0 12 12; 240 12 12; 120 12 12; 360 12 12" />
            <g>
                <circle cx="12" cy="3" r="3" />
                <path opacity="0.6" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" d="M3 12c0-4.9706 4.0294-9 9-9" stroke-dasharray="14.137167 14.137167" stroke-dashoffset="-2">
                    <animate attributeName="stroke-dashoffset" dur="2s" repeatCount="indefinite" values="-2; -14; -2" />
                </path>
            </g>
            <g transform="rotate(120 12 12)">
                <circle cx="12" cy="3" r="3" />
                <path opacity="0.6" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" d="M3 12c0-4.9706 4.0294-9 9-9" stroke-dasharray="14.137167 14.137167" stroke-dashoffset="-2">
                    <animate attributeName="stroke-dashoffset" dur="2s" repeatCount="indefinite" values="-2; -14; -2" />
                </path>
            </g>
            <g transform="rotate(-120 12 12)">
                <circle cx="12" cy="3" r="3" />
                <path opacity="0.6" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" d="M3 12c0-4.9706 4.0294-9 9-9" stroke-dasharray="14.137167 14.137167" stroke-dashoffset="-2">
                    <animate attributeName="stroke-dashoffset" dur="2s" repeatCount="indefinite" values="-2; -14; -2" />
                </path>
            </g>
        </g>
    </svg>
</template>

<style scoped>
:root, .palette0 {color: currentColor;
    --color0: #fff;
    --color1: #000;
}
</style>