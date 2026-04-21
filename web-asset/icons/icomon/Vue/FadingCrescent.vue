<template>
    <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <defs>
            <radialGradient id="fading_crescent_gradient1">
                <stop offset="65%" stop-color="var(--color1, #000)" />
                <stop offset="100%" stop-color="var(--color0, #fff)" />
            </radialGradient>
            <linearGradient id="fading_crescent_gradient0" gradientTransform="rotate(90 0.25 0.25)">
                <stop offset="0%" stop-color="currentColor" />
                <stop offset="85%" stop-color="currentColor" stop-opacity="0" />
            </linearGradient>
            <mask id="fading_crescent_m" color="#000">
                <rect fill="url(#fading_crescent_gradient1)" width="24" height="24" x="0" y="0" />
            </mask>
        </defs>
        <circle stroke-width="5" fill="url(#fading_crescent_gradient0)" cx="12" cy="12" mask="url(#fading_crescent_m)" r="12">
            <animateTransform attributeName="transform" dur="1s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
        </circle>
    </svg>
</template>

<style scoped>
:root, .palette0 {color: currentColor;
    --color0: #fff;
    --color1: #000;
}
</style>