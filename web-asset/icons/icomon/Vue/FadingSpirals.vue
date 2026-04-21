<template>
    <svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" fill="none" width="32" height="32" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <defs>
            <radialGradient id="fading_spirals_gradient1">
                <stop offset="39%" stop-color="var(--color0, #fff)" />
                <stop offset="83%" stop-color="currentColor" stop-opacity="0" />
            </radialGradient>
            <mask id="fading_spirals_m" color="#000">
                <rect stroke="none" fill="url(#fading_spirals_gradient1)" width="100%" height="100%" x="0" y="0" />
            </mask>
        </defs>
        <g mask="url(#fading_spirals_m)">
            <path class="st0" d="M11.9407 11.7587c-0.5898 1.0215 0.2344 2.5276 2.0047 2.6068 1.7627 0.0923 3.9603-1.4154 4.3652-4.3247 0.403-2.8754-1.2262-6.4352-5.0826-8.103C9.4107 0.2927 4.1873 1.0835 0.5154 5.1449" />
            <path class="st0" d="M11.9407 11.7588c-0.5898-1.0215-2.3062-1.0608-3.2599 0.4328-0.9614 1.4804-0.7544 4.1373 1.5627 5.9427 2.2887 1.7867 6.1861 2.1557 9.5587-0.3502 3.3333-2.4833 5.2602-7.4023 3.5789-12.6129" />
            <path class="st0" d="M11.9406 11.7588c1.1795 0 2.0718-1.4668 1.2552-3.0396-0.8015-1.5727-3.2059-2.722-5.9279-1.618-2.6917 1.0887-4.96 4.2795-4.4761 8.4532 0.4839 4.1284 3.7805 8.2567 9.1337 9.4059" />
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