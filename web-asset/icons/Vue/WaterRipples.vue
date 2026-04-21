<template>
    <svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <circle cx="12" cy="12" r="1">
            <animate id="water_ripples_one" attributeName="r" dur="3s" repeatCount="indefinite" values="1; 11" />
            <animate attributeName="opacity" dur="3s" repeatCount="indefinite" values="1; 0" />
        </circle>
        <circle cx="12" cy="12" r="1">
            <animate attributeName="r" begin="water_ripples_one.begin+1s" dur="3s" repeatCount="indefinite" values="1; 11" />
            <animate attributeName="opacity" begin="water_ripples_one.begin+1s" dur="3s" repeatCount="indefinite" values="1; 0" />
        </circle>
        <circle cx="12" cy="12" r="1">
            <animate attributeName="r" begin="water_ripples_one.begin+2s" dur="3s" repeatCount="indefinite" values="1; 11" />
            <animate attributeName="opacity" begin="water_ripples_one.begin+2s" dur="3s" repeatCount="indefinite" values="1; 0" />
        </circle>
    </svg>
</template>

<style scoped>
:root, .palette0 {color: currentColor;
    --color0: #fff;
    --color1: #000;
}
</style>