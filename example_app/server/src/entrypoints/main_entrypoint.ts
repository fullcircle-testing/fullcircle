import {JSON_PLACEHOLDER_URL} from '../constants';
import {ExampleAppDependencies} from '../types/app_dependencies';

import {initApp} from '../server';

const deps: ExampleAppDependencies = {
    externalUrl: JSON_PLACEHOLDER_URL,
};

const app = initApp(deps);

const port = process.env.PORT || 6001;
app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
});
