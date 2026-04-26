<template>
    <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <path opacity="0.3" d="M8 1h8v2H8z">
            <animate id="hexagon_sticks_a0" attributeName="opacity" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
        </path>
        <path opacity="0.3" d="M19.5263 3.0359l4 6.9282-1.7321 1-4-6.9282z">
            <animate attributeName="opacity" begin="hexagon_sticks_a0.begin+0.2s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
        </path>
        <path opacity="0.3" d="M23.5263 14.0359l-4 6.9282-1.7321-1 4-6.9282z">
            <animate attributeName="opacity" begin="hexagon_sticks_a0.begin+0.4s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
        </path>
        <path opacity="0.3" d="M16 23H8v-2h8z">
            <animate attributeName="opacity" begin="hexagon_sticks_a0.begin+0.6s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
        </path>
        <path opacity="0.3" d="M4.4737 20.9641l-4-6.9282 1.7321-1 4 6.9282z">
            <animate attributeName="opacity" begin="hexagon_sticks_a0.begin+0.8s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
        </path>
        <path opacity="0.3" d="M0.4737 9.9641l4-6.9282 1.7321 1-4 6.9282z">
            <animate attributeName="opacity" begin="hexagon_sticks_a0.begin+1s" dur="1.2s" repeatCount="indefinite" values="0.3; 0.3; 1; 0.3; 0.3" />
        </path>
    </svg>
</template>

<style scoped>
:root, .palette0 {color: currentColor;
    --color0: #fff;
    --color1: #000;
}
</style>