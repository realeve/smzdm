let mysql = require('mysql')
let config = require('./config').mysql
let logger = require('winston')
let mail = require('../controller/util/mail');
let util = require('../controller/util/common');

let pool = mysql.createPool(config)
let errorHandle = (errInfo, sql = 'none') => {
    if (errInfo) {
        mail.send({
            subject: '数据库读写异常',
            html: `${util.getNow()},errorInfo:<br>${errInfo}`
        });
        logger.error('Error occured.', {
            time: new Date().toLocaleString(),
            sql,
            errInfo
        })
    }
}

async function query(sql, data, callback) {
    if (typeof data == 'function') {
        callback = data;
    }
    return new Promise((resolve, reject) => {
        pool.getConnection((err, conn) => {
            if (sql.includes(' jd_comment ') && sql.includes('insert into ')) {
                conn.query('set names utf8mb4', (err, result) => {
                    if (err) {
                        conn.release();
                        resolve(result);
                    }
                });
            }

            // 此处应该会由conn.query自动判断data的属性从而决定parse还是callback
            conn.query(sql, data, (err, result) => {
                errorHandle(err, sql);
                conn.release();
                try {
                    result = JSON.stringify(result);
                    result = JSON.parse(result);
                    if (typeof callback == 'function') {
                        callback(result);
                    }
                    resolve(result);
                } catch (e) {
                    mail.send({
                        subject: '数据库读写异常',
                        html: `${util.getNow()},errorInfo:<br>${e.message}<br> ${JSON.stringify(e)} `
                    });
                }
            });
        });
    });
}

module.exports = query