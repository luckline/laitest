"""Bounded transport for travel generation, independent of case-generation settings."""
import http.client
import json
import os
import socket
import time
from urllib.parse import urlsplit


class TravelPlanError(RuntimeError):
    def __init__(self, code, status=502):
        super().__init__(code)
        self.code, self.status = code, status


def settings():
    def number(name, default, low, high):
        try:
            return max(low, min(high, float(os.environ.get(name, default))))
        except (ValueError, TypeError):
            return default
    return (number('DEEPSEEK_TRAVEL_TIMEOUT_S', 45, 5, 60),
            int(number('DEEPSEEK_TRAVEL_RETRIES', 1, 0, 1)),
            number('DEEPSEEK_TRAVEL_TOTAL_DEADLINE_S', 65, 10, 65))


def _attempt(url, key, body, deadline):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise TravelPlanError('AI_ENDPOINT_INVALID', 503)
    def remaining():
        value = deadline - time.monotonic()
        if value <= 0:
            raise TravelPlanError('AI_TIMEOUT', 504)
        return value
    connection = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=remaining())
    try:
        connection.request('POST', parsed.path + ('?' + parsed.query if parsed.query else ''), body,
                           {'Content-Type':'application/json', 'Authorization':'Bearer '+key,
                            'Accept-Encoding':'identity', 'Connection':'close'})
        # Retain the socket: HTTPConnection may detach it for Connection: close.
        sock = connection.sock
        sock.settimeout(remaining())
        with connection.getresponse() as response:
            status = response.status
            if status != 200:
                codes = {401:('AI_AUTH_FAILED',503),403:('AI_AUTH_FAILED',503),402:('AI_BALANCE_EMPTY',503),
                         429:('AI_RATE_LIMITED',429)}
                code, outgoing = codes.get(status, ('AI_UPSTREAM_UNAVAILABLE' if status >= 500 else 'AI_REQUEST_FAILED',502))
                raise TravelPlanError(code, outgoing)
            chunks, size = [], 0
            while True:
                sock.settimeout(remaining())
                chunk = response.read1(65536)
                remaining()  # A keep-alive trickle cannot reset the absolute budget.
                if not chunk:
                    break
                size += len(chunk)
                if size > 2 * 1024 * 1024:
                    raise TravelPlanError('AI_RESPONSE_INVALID')
                chunks.append(chunk)
            return b''.join(chunks).decode('utf-8')
    finally:
        connection.close()


def request_travel(url, key, payload):
    timeout, retries, budget = settings()
    end = time.monotonic() + budget
    body = json.dumps(payload, ensure_ascii=True).encode('utf-8')
    for attempt in range(retries + 1):
        try:
            return _attempt(url, key, body, min(end, time.monotonic() + timeout))
        except (socket.timeout, TimeoutError):
            failure = TravelPlanError('AI_TIMEOUT',504)
        except (OSError, http.client.HTTPException):
            failure = TravelPlanError('AI_CONNECTION_FAILED')
        except UnicodeError:
            failure = TravelPlanError('AI_RESPONSE_INVALID')
        except TravelPlanError as exc:
            failure = exc
        if (failure.code not in {'AI_TIMEOUT','AI_CONNECTION_FAILED','AI_UPSTREAM_UNAVAILABLE','AI_RATE_LIMITED'}
                or attempt >= retries or end - time.monotonic() < 6):
            raise failure
        time.sleep(1)
    raise TravelPlanError('AI_TIMEOUT',504)


def error_response(exc):
    if isinstance(exc, TravelPlanError):
        return {'error':exc.code, 'errorCode':exc.code, 'provider':'deepseek'}, exc.status
    code = 'AI_AUTH_FAILED' if 'missing DEEPSEEK_API_KEY' in str(exc) else 'AI_RESPONSE_INVALID'
    return {'error':code, 'errorCode':code, 'provider':'deepseek'}, 503 if code == 'AI_AUTH_FAILED' else 502
