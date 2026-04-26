<template>
    <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <defs>
            <linearGradient id="fading_ring_gradient0" gradientTransform="rotate(90 0.25 0.25)">
                <stop offset="0%" stop-color="currentColor" />
                <stop offset="80%" stop-color="currentColor" stop-opacity="0" />
            </linearGradient>
        </defs>
        <circle stroke-width="3" stroke="url(#fading_ring_gradient0)" fill="none" cx="12" cy="12" r="10.5">
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