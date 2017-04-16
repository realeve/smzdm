let mysql = require('mysql')
let config = require('./config').mysql
let logger = require('winston')

let pool = mysql.createPool(config)
let errorHandle = (errInfo, sql = 'none') => {
    if (errInfo) {
        logger.error('Error occured.', {
            time: new Date().toLocaleString(),
            sql,
            errInfo
        })
    }
}

function query(sql, callback) {
    pool.getConnection((err, conn) => {
        conn.query(sql, (err, result) => {
            errorHandle(err, sql);
            conn.release();
            result = JSON.stringify(result);
            result = JSON.parse(result);
            if (typeof callback == 'function') {
                callback(result);
            }
        })
    })
}

module.exports = query