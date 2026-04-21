<template>
    <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <rect opacity="0.3" width="4" height="4" x="10" y="3">
            <animate id="matrix_a0" attributeName="opacity" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
        </rect>
        <rect opacity="0.3" width="4" height="4" x="17" y="3">
            <animate attributeName="opacity" begin="matrix_a0.begin+0.1s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
        </rect>
        <rect opacity="0.3" width="4" height="4" x="17" y="10">
            <animate attributeName="opacity" begin="matrix_a0.begin+0.2s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
        </rect>
        <rect opacity="0.3" width="4" height="4" x="10" y="10">
            <animate attributeName="opacity" dur="0.4s" repeatCount="indefinite" values="0.3; 1; 0.3" />
        </rect>
        <rect opacity="0.3" width="4" height="4" x="17" y="17">
            <animate attributeName="opacity" begin="matrix_a0.begin+0.3s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
        </rect>
        <rect opacity="0.3" width="4" height="4" x="10" y="17">
            <animate attributeName="opacity" begin="matrix_a0.begin+0.4s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
        </rect>
        <rect opacity="0.3" width="4" height="4" x="3" y="17">
            <animate attributeName="opacity" begin="matrix_a0.begin+0.5s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
        </rect>
        <rect opacity="0.3" width="4" height="4" x="3" y="10">
            <animate attributeName="opacity" begin="matrix_a0.begin+0.6s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
        </rect>
        <rect opacity="0.3" width="4" height="4" x="3" y="3">
            <animate attributeName="opacity" begin="matrix_a0.begin+0.7s" dur="0.8s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
        </rect>
    </svg>
</template>

<style scoped>
:root, .palette0 {color: currentColor;
    --color0: #fff;
    --color1: #000;
}
</style>