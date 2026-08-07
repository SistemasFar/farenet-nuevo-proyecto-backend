const ping = (req, res) => {
    res.status(200).json({
        ok: true,
        module: "faregas",
        message: "FAREGAS backend operativo",
        timestamp: new Date().toISOString()
    });
};

module.exports = {
    ping
};
