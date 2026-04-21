<template>
    <svg viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <defs stroke-width="2">
            <linearGradient id="triple_circle_gradient0" gradientTransform="rotate(-90 0.75 0.25)">
                <stop offset="20%" stop-color="currentColor" />
                <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
            </linearGradient>
        </defs>
        <g>
            <circle stroke="url(#triple_circle_gradient0)" transform="rotate(120 12 7.5)" cx="12" cy="7.5" r="6.75">
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 7.5; 360 12 7.5" />
            </circle>
        </g>
        <g transform="rotate(120 12 12)">
            <circle stroke="url(#triple_circle_gradient0)" transform="rotate(120 12 7.5)" cx="12" cy="7.5" r="6.75">
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 7.5; 360 12 7.5" />
            </circle>
        </g>
        <g transform="rotate(-120 12 12)">
            <circle stroke="url(#triple_circle_gradient0)" transform="rotate(120 12 7.5)" cx="12" cy="7.5" r="6.75">
                <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 7.5; 360 12 7.5" />
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