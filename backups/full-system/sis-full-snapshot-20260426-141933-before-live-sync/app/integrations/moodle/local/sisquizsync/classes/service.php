<?php
// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

namespace local_sisquizsync;

defined('MOODLE_INTERNAL') || die();

class service {
    public static function is_configured(): bool {
        $config = get_config('local_sisquizsync');
        return !empty($config->enabled) && !empty($config->endpointurl) && !empty($config->sharedsecret);
    }

    public static function send_payload(array $payload): void {
        $config = get_config('local_sisquizsync');
        if (empty($config->enabled)) {
            return;
        }

        $endpointurl = trim((string) ($config->endpointurl ?? ''));
        $sharedsecret = trim((string) ($config->sharedsecret ?? ''));
        if ($endpointurl === '' || $sharedsecret === '') {
            throw new \coding_exception('local_sisquizsync is missing endpoint or shared secret configuration');
        }

        $retrycount = max(1, (int) ($config->retrycount ?? 3));
        $timeoutseconds = max(1, (int) ($config->timeoutseconds ?? 10));
        $connecttimeout = max(1, min(10, $timeoutseconds));
        $body = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($body === false) {
            throw new \coding_exception('Unable to encode Moodle quiz payload');
        }

        $laststatus = 0;
        $lastresponse = '';

        for ($attempt = 1; $attempt <= $retrycount; $attempt += 1) {
            $timestamp = (string) time();
            $signature = hash_hmac('sha256', $timestamp . "\n" . $body, $sharedsecret);

            $curl = new \curl();
            $curl->setHeader([
                'Content-Type: application/json',
                'Accept: application/json',
                'Expect:',
                'X-SIS-Source: moodle',
                'X-SIS-Timestamp: ' . $timestamp,
                'X-SIS-Signature: ' . $signature,
            ]);

            $response = $curl->post($endpointurl, $body, [
                'CURLOPT_TIMEOUT' => $timeoutseconds,
                'CURLOPT_CONNECTTIMEOUT' => $connecttimeout,
            ]);
            $info = $curl->get_info();
            $status = (int) ($info['http_code'] ?? 0);
            if ($status >= 200 && $status < 300) {
                return;
            }

            $laststatus = $status;
            $lastresponse = is_string($response) ? $response : '';

            if ($attempt < $retrycount) {
                usleep(250000 * $attempt);
            }
        }

        throw new \moodle_exception(
            'sisquizsyncfailed',
            'local_sisquizsync',
            '',
            null,
            'HTTP ' . $laststatus . ($lastresponse !== '' ? ': ' . $lastresponse : '')
        );
    }
}
