FROM mdcng/mdc:beta@sha256:e240456454872ae7b3bd2da193f444929068b2d3412be8869ef9cfd0df7d017d

COPY server.js /opt/mdc-extension/server.js
COPY entrypoint.sh /opt/mdc-extension/entrypoint.sh

EXPOSE 9209
ENTRYPOINT ["/bin/sh", "/opt/mdc-extension/entrypoint.sh"]
CMD ["start-frontend.sh"]
