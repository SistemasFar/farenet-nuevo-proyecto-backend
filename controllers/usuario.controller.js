const getPlantasByUsuario = async (req, res) => {
    try {
        // Formato de respuesta mockeado idéntico a lo que exige el flujo visual de Farenet
        const plantasMock = [
            { id: 1, nombre: "Planta Principal Farenet", codigo: "PL-01", estado: true }
        ];
        return res.status(200).json(plantasMock);
    } catch (error) {
        return res.status(500).json({ message: "Error al obtener plantas asignadas." });
    }
};

module.exports = {
    getPlantasByUsuario
};
