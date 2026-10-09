"""One TLS context for every outgoing HTTPS request.

Building an SSL context reads the whole CA bundle: about 0.15 s on a quiet
laptop and 0.7 s each when the map collected 36 SACHET feeds at once. A new
context per request did that on the event loop, so the server froze for
seconds at a time and a chat question asked meanwhile took 35 s. Every
httpx client passes `verify=TLS` instead.
"""
import httpx

TLS = httpx.create_ssl_context()
