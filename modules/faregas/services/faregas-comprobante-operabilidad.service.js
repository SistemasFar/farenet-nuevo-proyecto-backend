// Fachada neutral compartida por los flujos administrativos. La política
// tributaria autoritativa sigue centralizada en documento-tributario-policy.
const { esDocumentoBaseOperable } = require('./faregas-documento-tributario-policy');

module.exports = { esDocumentoBaseOperable };
