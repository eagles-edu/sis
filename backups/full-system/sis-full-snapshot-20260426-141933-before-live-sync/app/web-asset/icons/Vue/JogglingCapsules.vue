<template>
    <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <g>
            <animateTransform attributeName="transform" dur="5s" repeatCount="indefinite" type="rotate" values="0 12 12; 360 12 12" />
            <line stroke-width="2" stroke="currentColor" stroke-linecap="round" x1="12" x2="12" y1="1" y2="8">
                <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360 12 5; 0 12 5" />
                <animate attributeName="y1" dur="4s" repeatCount="indefinite" type="rotate" values="1; 5; 5; 1" />
                <animate attributeName="y2" dur="4s" repeatCount="indefinite" type="rotate" values="8; 5; 5; 8" />
                <animate attributeName="stroke-width" dur="4s" repeatCount="indefinite" type="rotate" values="2; 6; 6; 2" />
            </line>
            <g transform="rotate(120 12 12)">
                <line stroke-width="2" stroke="currentColor" stroke-linecap="round" x1="12" x2="12" y1="1" y2="8">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360 12 5; 0 12 5" />
                    <animate attributeName="y1" dur="4s" repeatCount="indefinite" type="rotate" values="1; 5; 5; 1" />
                    <animate attributeName="y2" dur="4s" repeatCount="indefinite" type="rotate" values="8; 5; 5; 8" />
                    <animate attributeName="stroke-width" dur="4s" repeatCount="indefinite" type="rotate" values="2; 6; 6; 2" />
                </line>
            </g>
            <g transform="rotate(-120 12 12)">
                <line stroke-width="2" stroke="currentColor" stroke-linecap="round" x1="12" x2="12" y1="1" y2="8">
                    <animateTransform attributeName="transform" dur="2s" repeatCount="indefinite" type="rotate" values="360 12 5; 0 12 5" />
                    <animate attributeName="y1" dur="4s" repeatCount="indefinite" type="rotate" values="1; 5; 5; 1" />
                    <animate attributeName="y2" dur="4s" repeatCount="indefinite" type="rotate" values="8; 5; 5; 8" />
                    <animate attributeName="stroke-width" dur="4s" repeatCount="indefinite" type="rotate" values="2; 6; 6; 2" />
                </line>
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