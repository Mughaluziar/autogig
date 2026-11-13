"""Upwork, connected directly over OAuth 2.0 (no Nango).

store.py   connections (one per user per Upwork account; tokens encrypted at
           rest) and single-use OAuth states
client.py  the OAuth flow, token refresh and GraphQL calls

The connect flow is in routers/upwork_connect.py; job search
(routers/upwork.py) and order sync (orders/adapters/upwork.py) call Upwork
through client.graphql(). See docs/upwork-oauth.md.
"""
