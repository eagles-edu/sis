<template>
    <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <circle cx="12" cy="3" r="3">
            <animate id="gradual_bump_a0" attributeName="r" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
        </circle>
        <circle cx="18.364" cy="5.63604" r="2.5">
            <animate attributeName="r" begin="gradual_bump_a0.begin+0.1s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
        </circle>
        <circle cx="21" cy="12" r="2">
            <animate attributeName="r" begin="gradual_bump_a0.begin+0.2s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
        </circle>
        <circle cx="18.364" cy="18.364" r="2">
            <animate attributeName="r" begin="gradual_bump_a0.begin+0.3s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
        </circle>
        <circle cx="12" cy="21" r="2">
            <animate attributeName="r" begin="gradual_bump_a0.begin+0.4s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
        </circle>
        <circle cx="5.63604" cy="18.364" r="2">
            <animate attributeName="r" begin="gradual_bump_a0.begin+0.5s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
        </circle>
        <circle cx="3" cy="12" r="2">
            <animate attributeName="r" begin="gradual_bump_a0.begin+0.6s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
        </circle>
        <circle cx="5.63604" cy="5.63604" r="2.5">
            <animate attributeName="r" begin="gradual_bump_a0.begin+0.7s" dur="0.8s" repeatCount="indefinite" values="2; 2; 3; 2; 2" />
        </circle>
    </svg>
</template>

<style scoped>
:root, .palette0 {color: currentColor;
    --color0: #fff;
    --color1: #000;
}
</style>