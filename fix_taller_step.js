const fs = require('fs');
const p = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/views/NuevoCertificado/components/NuevoCertificado/TallerStep.tsx';
let t = fs.readFileSync(p, 'utf8');

const oldImports = `import React from 'react';
import type { FormularioFormatoDinamicoFaregas } from '../../../../types/faregas-api';

interface TallerStepProps {
  formulario: FormularioFormatoDinamicoFaregas | null;
  valores: Record<string, string>;
  setValores: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  cargando?: boolean;
  error?: string;
}`;

const newImports = `import React from 'react';
import type { FormularioFormatoDinamicoFaregas } from '../../../../types/faregas-api';
import { TitularesList } from './TitularesList';
import type { TitularState } from './TitularesList';
import type { FormFacturacionState } from '../../NuevoCertificadoView';

interface TallerStepProps {
  formulario: FormularioFormatoDinamicoFaregas | null;
  valores: Record<string, string>;
  setValores: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  cargando?: boolean;
  error?: string;
  titulares: TitularState[];
  setTitulares: React.Dispatch<React.SetStateAction<TitularState[]>>;
  formFacturacion: FormFacturacionState;
  setFormFacturacion: React.Dispatch<React.SetStateAction<FormFacturacionState>>;
  onRemoveTitular?: (titular: TitularState) => Promise<void>;
}`;

t = t.replace(oldImports, newImports);

const oldFnDef = `export const TallerStep: React.FC<TallerStepProps> = ({ formulario, valores, setValores, cargando, error }) => {`;
const newFnDef = `export const TallerStep: React.FC<TallerStepProps> = ({ 
  formulario, valores, setValores, cargando, error,
  titulares, setTitulares, formFacturacion, setFormFacturacion, onRemoveTitular 
}) => {`;

t = t.replace(oldFnDef, newFnDef);

const oldReturn = `    </div>
  );
};`;
const newReturn = `      <TitularesList
        titulares={titulares}
        setTitulares={setTitulares}
        formFacturacion={formFacturacion}
        setFormFacturacion={setFormFacturacion}
        onRemoveTitular={onRemoveTitular}
      />
    </div>
  );
};`;

t = t.replace(oldReturn, newReturn);

fs.writeFileSync(p, t);
console.log('TallerStep.tsx modified successfully');
