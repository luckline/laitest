from pathlib import Path
import sys, os, socket
from unittest.mock import patch, MagicMock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from laitest.travel_transport import settings, request_travel, _attempt, TravelPlanError, error_response

def error_code(fn):
    try: fn()
    except TravelPlanError as e: return e.code
    raise AssertionError('expected failure')

with patch.dict(os.environ,{'DEEPSEEK_TIMEOUT_S':'120','DEEPSEEK_RETRIES':'5','DEEPSEEK_TOTAL_DEADLINE_S':'300'},clear=True):
    assert settings() == (45,1,65)
with patch.dict(os.environ,{'DEEPSEEK_TRAVEL_TOTAL_DEADLINE_S':'300','DEEPSEEK_TRAVEL_RETRIES':'5'},clear=True):
    assert settings()[1:] == (1,65)
with patch('laitest.travel_transport._attempt',side_effect=[TravelPlanError('AI_UPSTREAM_UNAVAILABLE'),'ok']) as attempt, patch('laitest.travel_transport.time.sleep'):
    assert request_travel('https://example.test','fake',{}) == 'ok'
    assert attempt.call_count == 2
for code in ['AI_AUTH_FAILED','AI_BALANCE_EMPTY','AI_RESPONSE_INVALID']:
    with patch('laitest.travel_transport._attempt',side_effect=TravelPlanError(code)) as attempt:
        assert error_code(lambda:request_travel('https://example.test','fake',{})) == code
        assert attempt.call_count == 1
with patch('laitest.travel_transport._attempt',side_effect=socket.timeout),patch('laitest.travel_transport.time.sleep'):
    assert error_code(lambda:request_travel('https://example.test','fake',{})) == 'AI_TIMEOUT'
# Simulate a server continually returning keepalive bytes across the deadline.
conn=MagicMock(); response=MagicMock();response.status=200
conn.getresponse.return_value.__enter__.return_value=response
response.read1.return_value=b'\n'
with patch('laitest.travel_transport.http.client.HTTPSConnection',return_value=conn),patch('laitest.travel_transport.time.monotonic',side_effect=[0,0,0,66]):
    assert error_code(lambda:_attempt('https://example.test/v1/chat','fake',b'{}',65)) == 'AI_TIMEOUT'
assert conn.close.called
assert 'secret' not in str(error_response(RuntimeError('parse failed secret')))
# Confirm HTTP classifications without reading an error body or retrying auth/balance.
for status,code in [(402,'AI_BALANCE_EMPTY'),(429,'AI_RATE_LIMITED'),(401,'AI_AUTH_FAILED'),(503,'AI_UPSTREAM_UNAVAILABLE')]:
    conn=MagicMock();response=MagicMock();response.status=status
    conn.getresponse.return_value.__enter__.return_value=response
    with patch('laitest.travel_transport.http.client.HTTPSConnection',return_value=conn):
        import time
        assert error_code(lambda:_attempt('https://example.test','fake',b'{}',time.monotonic()+60)) == code
    response.read1.assert_not_called()
print('PASS travel budget, bounded retry, terminal failures, keepalive deadline, safe errors, HTTP categories')

from laitest.ai import generate_travel_plan
with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'fixture-only'}),patch('laitest.travel_transport._attempt',return_value='{"choices":[{"message":{"content":"Day 1: fixture route"}}]}'):
    assert generate_travel_plan('synthetic test') == 'Day 1: fixture route'
print('PASS travel generator integration')
