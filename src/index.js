const debug = require('debug')('log2amqp');
const AMQP = require('simple-amqplib');
const joi = require('joi');
const formatPayload = require('./payload');

async function getAMQP (config) {
  try {
    const amqp = new AMQP(config);
    await amqp.connect();
    return amqp;
  } catch (err) {
    debug('Error connecting to amqp', { config }, err.message);
    return 'failed';
  }
}

function validateConfig (config) {
  joi.assert(config, joi.object({
    source: joi.string().required(),
    schemaVersion: joi.number().integer().valid([2, 3]).required()
  }).unknown(true));
}

/** Class to manage a single logging session that collects logs and flushes them to
 *  AMQP.
 */

class AMQPLogger {
  /**
   * Create an AMQPLogger instance.
   * @param {Object} config
   *
   * @description
   * - config
   *   - source - the source you are logging from
   *   - amqp.url - the url of the rabbitmq server
   *   - amqp.exchange - the exchange that will be asserted and used to publish to
   *   - amqp.routingKey - the RK to publish logs to
   *   - schemaVersion - schema version to use. Valid values are 2, 3.
   */
  constructor (config) {
    validateConfig(config);
    this.config = config;
    this.amqp = getAMQP(config.amqp);
    this.flushed = false;
    this.logs = [];
  }

  /**
   * Add a log to the current state. Each call to log() results in a entry
   * added to the 'data' array placed at the top level of the published json.
   * @param {string} type
   * @param {object} payload
   */
  log (type, payload) {
    if (this.flushed) throw new Error('Already flushed.');
    const entry = { type, data: payload };
    this.logs.push(entry);
  }

  /**
   * Flush logs to AMQP as a single message.
   * @param {object} opts
   * @description
   * opts.meta - This data is put in a top level 'meta' field in the published JSON.
   */
  async flush (opts = {}) {
    const { meta } = opts;
    if (this.flushed) throw new Error('Already flushed.');
    let amqp;
    try {
      this.flushed = true;
      amqp = await this.amqp;
      if (amqp === 'failed') return;
      const payload = formatPayload(this.config, this.logs);
      if (meta) payload.meta = meta;
      await amqp.publish(this.config.amqp.routingKey, payload);
    } catch (err) {
      debug(err);
    }
    // We explicitly set this to undefined just in case somehow there is a
    // reference back to the logger in the logged payload.
    // Such a circular reference would prevent garbage collection.
    this.logs = undefined;
    try { amqp.close(); } catch (_err) {}
  }
}

module.exports = AMQPLogger;
